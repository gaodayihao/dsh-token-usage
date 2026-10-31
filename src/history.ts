/**
 * 历史基线（History baseline）——把"已经丢失、只能从截图/外部记录补回"的时段
 * 作为一段独立汇总合并进面板，而不是伪造会话日志。
 *
 * 设计约束：
 *  - 基线文件由插件自己持有：`~/.dsh/storages/dsh-token-usage/history-baseline.v1.json`，
 *    删掉即回滚，不影响投影缓存和任何真实会话数据；
 *  - 基线只参与 `buildGlobalSnapshot` 的合并，不进入投影单元、不写 session_projcache；
 *  - 每日 token 允许是估算值（`dailyEstimated: true`），面板会标注"含导入历史"；
 *  - 基线时段与真实会话时段重叠时按日期相加（正常情况下不重叠；万一重叠会重复计数，
 *    由维护者保证，不做自动去重）。
 * @module @deepseek-ai/dsh-token-usage/history
 */

/** 历史基线的完整字段（可持久化 JSON）。 */
export interface HistoryBaseline {
  /** 展示用标签，例如“磁盘损坏前，按截图导入”。 */
  label: string
  /** 覆盖的日期范围 ['YYYY-MM-DD', 'YYYY-MM-DD']。 */
  range: [string, string]
  /** 该时段的累计 token；缺省时用 dailyTokens 求和。 */
  totalTokens?: number
  /** 单会话峰值 token。 */
  peakTokens?: number
  /** 最长连续聊天段（秒）。 */
  maxDurationSec?: number
  /** 会话数 / 消息数 / 工具调用数。 */
  totalConversations?: number
  totalMessages?: number
  totalToolCalls?: number
  /** 工具种类数（与真实数据合并时取较大值，无法求精确并集）。 */
  distinctTools?: number
  /** 插件 Top（名称 -> 次数）。 */
  topPlugins?: Array<[string, number]>
  /** Skill 数据（可选）。 */
  totalSkillUses?: number
  distinctSkills?: number
  topSkills?: Array<[string, number]>
  /** 推理档位 / 模型分布（可选；缺省时面板沿用真实会话的分布）。 */
  thinkingLevels?: { high: number; medium: number; low: number; off: number }
  modelBreakdown?: Record<string, number>
  /** 每日 token：'YYYY-MM-DD' -> 当日总量。 */
  dailyTokens: Record<string, number>
  /** 每日数值是否为估算（截图色阶还原 / 均值推断）。 */
  dailyEstimated: boolean
  /** 有会话活动的日期（用于连续天数；缺省时用 dailyTokens 的日期）。 */
  activeDates?: string[]
  /** 明确给出的当前/最长连续天数（没有 activeDates 时的兜底）。 */
  currentStreak?: number
  longestStreak?: number
  /** 导入时间（epoch ms，由加载器补齐）。 */
  importedAt?: number
  /** 自由备注（不参与合并）。 */
  notes?: string
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function isDay(value: unknown): value is string {
  return typeof value === 'string' && DAY_PATTERN.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime())
}

function pairs(value: unknown): Array<[string, number]> | undefined {
  if (!Array.isArray(value)) return undefined
  const out: Array<[string, number]> = []
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2) return undefined
    const [name, count] = item
    if (typeof name !== 'string' || !name) return undefined
    const numeric = num(count)
    if (numeric === undefined) return undefined
    out.push([name, numeric])
  }
  return out
}

/** 解析并校验基线 JSON；任何结构性错误都返回 undefined（fail-soft，不影响统计）。 */
export function parseHistoryBaseline(raw: unknown): HistoryBaseline | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  if (value.version !== 1) return undefined
  const label = typeof value.label === 'string' && value.label ? value.label : '历史导入'
  const range = value.range
  if (!Array.isArray(range) || range.length !== 2 || !isDay(range[0]) || !isDay(range[1])) return undefined
  if (range[0] > range[1]) return undefined
  const dailyRaw = value.dailyTokens
  if (!dailyRaw || typeof dailyRaw !== 'object') return undefined
  const dailyTokens: Record<string, number> = {}
  for (const [day, amount] of Object.entries(dailyRaw as Record<string, unknown>)) {
    if (!isDay(day)) return undefined
    const numeric = num(amount)
    if (numeric === undefined) return undefined
    if (numeric > 0) dailyTokens[day] = numeric
  }
  const totalTokens = num(value.totalTokens) ?? Object.values(dailyTokens).reduce((a, b) => a + b, 0)
  if (!(totalTokens > 0)) return undefined
  const thinking = value.thinkingLevels as Record<string, unknown> | undefined
  let thinkingLevels: HistoryBaseline['thinkingLevels']
  if (thinking && typeof thinking === 'object') {
    const high = num(thinking.high)
    const medium = num(thinking.medium)
    const low = num(thinking.low)
    const off = num(thinking.off)
    if (high !== undefined && medium !== undefined && low !== undefined && off !== undefined) {
      thinkingLevels = { high, medium, low, off }
    }
  }
  let modelBreakdown: Record<string, number> | undefined
  if (value.modelBreakdown && typeof value.modelBreakdown === 'object') {
    const models: Record<string, number> = {}
    for (const [name, count] of Object.entries(value.modelBreakdown as Record<string, unknown>)) {
      const numeric = num(count)
      if (numeric !== undefined && numeric > 0) models[name] = numeric
    }
    if (Object.keys(models).length > 0) modelBreakdown = models
  }
  const activeDatesRaw = value.activeDates
  let activeDates: string[] | undefined
  if (Array.isArray(activeDatesRaw) && activeDatesRaw.every(isDay)) activeDates = [...new Set(activeDatesRaw as string[])].sort()
  return {
    label,
    range: [range[0], range[1]],
    totalTokens,
    peakTokens: num(value.peakTokens),
    maxDurationSec: num(value.maxDurationSec),
    totalConversations: num(value.totalConversations),
    totalMessages: num(value.totalMessages),
    totalToolCalls: num(value.totalToolCalls),
    distinctTools: num(value.distinctTools),
    topPlugins: pairs(value.topPlugins),
    totalSkillUses: num(value.totalSkillUses),
    distinctSkills: num(value.distinctSkills),
    topSkills: pairs(value.topSkills),
    thinkingLevels,
    modelBreakdown,
    dailyTokens,
    dailyEstimated: value.dailyEstimated !== false,
    activeDates,
    currentStreak: num(value.currentStreak),
    longestStreak: num(value.longestStreak),
    importedAt: num(value.importedAt),
    notes: typeof value.notes === 'string' ? value.notes : undefined,
  }
}
