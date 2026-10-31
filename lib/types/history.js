/* Built from src/history.ts by scripts/build-lib.mjs — do not edit directly. */
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

                            

                                           

                                       

                  

                 

                        



                                  

                       

                   



                                     


                                    

                               

                                            

                                          


                            

                  



const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function num(value         )                     {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function isDay(value         )                  {
  return typeof value === 'string' && DAY_PATTERN.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime())
}

function pairs(value         )                                      {
  if (!Array.isArray(value)) return undefined
  const out                          = []
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
export function parseHistoryBaseline(raw         )                              {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw
  if (value.version !== 1) return undefined
  const label = typeof value.label === 'string' && value.label ? value.label : '历史导入'
  const range = value.range
  if (!Array.isArray(range) || range.length !== 2 || !isDay(range[0]) || !isDay(range[1])) return undefined
  if (range[0] > range[1]) return undefined
  const dailyRaw = value.dailyTokens
  if (!dailyRaw || typeof dailyRaw !== 'object') return undefined
  const dailyTokens                         = {}
  for (const [day, amount] of Object.entries(dailyRaw                           )) {
    if (!isDay(day)) return undefined
    const numeric = num(amount)
    if (numeric === undefined) return undefined
    if (numeric > 0) dailyTokens[day] = numeric
  }
  const totalTokens = num(value.totalTokens) ?? Object.values(dailyTokens).reduce((a, b) => a + b, 0)
  if (!(totalTokens > 0)) return undefined
  const thinking = value.thinkingLevels
  let thinkingLevels
  if (thinking && typeof thinking === 'object') {
    const high = num(thinking.high)
    const medium = num(thinking.medium)
    const low = num(thinking.low)
    const off = num(thinking.off)
    if (high !== undefined && medium !== undefined && low !== undefined && off !== undefined) {
      thinkingLevels = { high, medium, low, off }
    }
  }
  let modelBreakdown
  if (value.modelBreakdown && typeof value.modelBreakdown === 'object') {
    const models                         = {}
    for (const [name, count] of Object.entries(value.modelBreakdown                           )) {
      const numeric = num(count)
      if (numeric !== undefined && numeric > 0) models[name] = numeric
    }
    if (Object.keys(models).length > 0) modelBreakdown = models
  }
  const activeDatesRaw = value.activeDates
  let activeDates
  if (Array.isArray(activeDatesRaw) && activeDatesRaw.every(isDay)) activeDates = [...new Set(activeDatesRaw            )].sort()
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


//# sourceURL=src/history.ts