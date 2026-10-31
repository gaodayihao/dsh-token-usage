/**
 * 历史基线（截图/外部记录补回的丢失时段）类型声明。
 * 实现见 lib/types/history.js（由 src/history.ts 生成）。
 * @module @deepseek-ai/dsh-token-usage/history
 */
export interface HistoryBaseline {
    label: string;
    range: [string, string];
    totalTokens?: number;
    peakTokens?: number;
    maxDurationSec?: number;
    totalConversations?: number;
    totalMessages?: number;
    totalToolCalls?: number;
    distinctTools?: number;
    topPlugins?: Array<[string, number]>;
    totalSkillUses?: number;
    distinctSkills?: number;
    topSkills?: Array<[string, number]>;
    thinkingLevels?: {
        high: number;
        medium: number;
        low: number;
        off: number;
    };
    modelBreakdown?: Record<string, number>;
    dailyTokens: Record<string, number>;
    dailyEstimated: boolean;
    activeDates?: string[];
    currentStreak?: number;
    longestStreak?: number;
    importedAt?: number;
    notes?: string;
}
export declare function parseHistoryBaseline(raw: unknown): HistoryBaseline | undefined;
