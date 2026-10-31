/**
 * Token 统计面板 — 跨平面 wire 类型（host 聚合输出 / 浏览器面板消费）。
 * 全部为纯 JSON 可序列化数据，无任何 live 引用。
 * @module @deepseek-ai/dsh-token-usage
 */

/** 单条 usage 记录的 token 字段（DSH TokenUsage 口径）。 */
export interface TokenUsageFields {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
}

/** 推理强度档位计数（取 `request/header` 的 reasoningEffort；无该事件时回退 reasoningTokens 近似）。 */
export interface ThinkingLevelCounts {
  high: number
  medium: number
  low: number
  off: number
}

/** 回填阶段。 */
export type BackfillPhase = 'idle' | 'scanning' | 'backfilling' | 'ready' | 'fallback'

/** 历史数据回填进度（首次安装/缓存未命中时逐步填充）。 */
export interface BackfillProgress {
  /** 当前阶段：扫描会话列表 / 冷读回填 / 就绪 / 兜底模式（无投影缓存服务）。 */
  phase: BackfillPhase
  /** 已完成的会话数（命中缓存 + 冷读完成）。 */
  done: number
  /** 需要覆盖的会话总数。 */
  total: number
  /** 直接命中投影缓存、零日志 I/O 的会话数。 */
  fromCache: number
  /** 本次进程内从原始日志冷读的会话数。 */
  coldReads: number
  /** 数据来源：DSH 投影缓存，或插件自持久化兜底。 */
  mode: 'projection' | 'fallback'
}

/** 已导入的历史基线摘要（面板据此显示“含导入历史”）。 */
export interface HistoryBaselineInfo {
  /** 展示标签，例如“磁盘损坏前，按截图导入”。 */
  label: string
  /** 覆盖的日期范围 ['YYYY-MM-DD', 'YYYY-MM-DD']。 */
  range: [string, string]
  /** 该时段累计 token。 */
  totalTokens: number
  /** 每日数值是否为估算。 */
  estimatedDaily: boolean
  /** 导入时间（epoch ms）。 */
  importedAt: number
}

/** getStats 快照：一次调用返回的全量聚合（Codex 个人用量页口径）。 */
export interface TokenUsageSnapshot {
  /** 有历史记录的会话总数。 */
  totalConversations: number
  /** 全部会话的消息总数。 */
  totalMessages: number
  /** 累计 token（input + output + cacheRead + cacheWrite）。 */
  totalTokens: number
  /** 单会话峰值 token。 */
  peakTokens: number
  /** 最长连续聊天段（秒；>30min 间隔切分）。 */
  maxDurationSec: number
  /** 最长聊天时长的展示文本（"x天 y小时"）。 */
  maxDurationText: string
  /** 当前连续活跃天数。 */
  currentStreak: number
  /** 历史最长连续活跃天数。 */
  longestStreak: number
  /** 每日 token 用量：'YYYY-MM-DD' -> 当日 total。 */
  dailyTokens: Record<string, number>
  /** 推理强度档位计数。 */
  thinkingLevels: ThinkingLevelCounts
  /** 工具调用总数。 */
  totalToolCalls: number
  /** 出现过的工具种类数。 */
  distinctTools: number
  /** 非核心工具（视为插件）Top5：[名称, 次数]。 */
  topPlugins: Array<[string, number]>
  /** skill 使用次数 Top5：[skill 名, 次数]。 */
  topSkills: Array<[string, number]>
  /** skill 调用总数。 */
  totalSkillUses: number
  /** 出现过的 skill 种类数。 */
  distinctSkills: number
  /** 模型族计数（provider model id -> 短族名）。 */
  modelBreakdown: Record<string, number>
  /** 最早会话日期 'YYYY-MM-DD'。 */
  earliestDate: string
  /** 最近会话日期 'YYYY-MM-DD'。 */
  latestDate: string
  /** 快照生成时间（epoch ms）。 */
  updatedAt: number
  /** 历史回填进度（面板据此显示"统计中 x/y"）。 */
  backfill: BackfillProgress
  /** 已导入的历史基线（没有导入时为 null）。 */
  history: HistoryBaselineInfo | null
}
