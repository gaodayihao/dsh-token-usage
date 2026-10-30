/**
 * Token 统计面板 — 跨平面 wire 类型（host 聚合输出 / 浏览器面板消费）。
 * 全部为纯 JSON 可序列化数据，无任何 live 引用。
 * @module @deepseek-ai/dsh-token-usage
 */

/** 单条 usage 记录的 token 字段（DSH TokenUsage 口径）。 */
export interface TokenUsageFields {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
}
/** 推理强度档位计数（取 request/header 的 reasoningEffort；无该事件时回退 reasoningTokens 近似）。 */
export interface ThinkingLevelCounts {
    high: number;
    medium: number;
    low: number;
    off: number;
}
/** 回填阶段。 */
export type BackfillPhase = 'idle' | 'scanning' | 'backfilling' | 'ready' | 'fallback';
/** 历史数据回填进度（首次安装/缓存未命中时逐步填充）。 */
export interface BackfillProgress {
    phase: BackfillPhase;
    done: number;
    total: number;
    fromCache: number;
    coldReads: number;
    mode: 'projection' | 'fallback';
}
/** getStats 快照：一次调用返回的全量聚合（Codex 个人用量页口径）。 */
export interface TokenUsageSnapshot {
    totalConversations: number;
    totalMessages: number;
    totalTokens: number;
    peakTokens: number;
    maxDurationSec: number;
    maxDurationText: string;
    currentStreak: number;
    longestStreak: number;
    dailyTokens: Record<string, number>;
    thinkingLevels: ThinkingLevelCounts;
    totalToolCalls: number;
    distinctTools: number;
    topPlugins: Array<[string, number]>;
    topSkills: Array<[string, number]>;
    totalSkillUses: number;
    distinctSkills: number;
    modelBreakdown: Record<string, number>;
    earliestDate: string;
    latestDate: string;
    updatedAt: number;
    backfill: BackfillProgress;
}
