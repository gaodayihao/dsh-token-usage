/**
 * Token 统计面板 — 跨平面 wire 类型（host 聚合输出 / 浏览器面板消费）。
 * 全部为纯 JSON 可序列化数据，无任何 live 引用。
 * @module @deepseek-ai/dsh-token-stats
 */
/** 单条 usage 记录的 token 字段（DSH TokenUsage 口径）。 */
export interface TokenUsageFields {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
}
/** 推理强度档位计数（由 reasoningTokens 近似；DSH 无显式 thinking 等级）。 */
export interface ThinkingLevelCounts {
    high: number;
    medium: number;
    low: number;
    off: number;
}
/** getStats 快照：一次调用返回的全量聚合（Session Gallery / Codex 个人用量页口径）。 */
export interface TokenStatsSnapshot {
    /** 有历史记录的会话总数。 */
    totalConversations: number;
    /** 全部会话的消息总数。 */
    totalMessages: number;
    /** 累计 token（input + output + cacheRead + cacheWrite）。 */
    totalTokens: number;
    /** 单会话峰值 token。 */
    peakTokens: number;
    /** 最长连续聊天段（秒；>30min 间隔切分）。 */
    maxDurationSec: number;
    /** 最长聊天时长的展示文本（"x天 y小时"）。 */
    maxDurationText: string;
    /** 当前连续活跃天数。 */
    currentStreak: number;
    /** 历史最长连续活跃天数。 */
    longestStreak: number;
    /** 每日 token 用量：'YYYY-MM-DD' -> 当日 total。 */
    dailyTokens: Record<string, number>;
    /** 推理强度档位计数。 */
    thinkingLevels: ThinkingLevelCounts;
    /** 工具调用次数 Top5：[名称, 次数]。 */
    topTools: Array<[string, number]>;
    /** 工具调用总数。 */
    totalToolCalls: number;
    /** 出现过的工具种类数。 */
    distinctTools: number;
    /** 非核心工具（视为插件）Top5：[名称, 次数]。 */
    topPlugins: Array<[string, number]>;
    /** skill 使用次数 Top5：[skill 名, 次数]。 */
    topSkills: Array<[string, number]>;
    /** skill 调用总数。 */
    totalSkillUses: number;
    /** 出现过的 skill 种类数。 */
    distinctSkills: number;
    /** 会话类型计数（DSH 下固定 'dsh'）。 */
    typeBreakdown: Record<string, number>;
    /** 模型族计数（provider model id -> 短族名）。 */
    modelBreakdown: Record<string, number>;
    /** 最早会话日期 'YYYY-MM-DD'。 */
    earliestDate: string;
    /** 最近会话日期 'YYYY-MM-DD'。 */
    latestDate: string;
    /** 快照生成时间（epoch ms）。 */
    updatedAt: number;
}
//# sourceMappingURL=types.d.ts.map