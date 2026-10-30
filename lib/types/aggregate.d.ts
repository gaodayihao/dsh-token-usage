/**
 * 纯聚合模块类型声明（实现见 lib/types/aggregate.js）。
 * @module @deepseek-ai/dsh-token-usage/aggregate
 */
import type { BackfillProgress, ThinkingLevelCounts, TokenUsageSnapshot } from './types.ts';
export interface TokenBuckets {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}
export interface LastSettlement {
    turn: number;
    step: number;
    day: string;
    total: number;
    buckets: TokenBuckets;
}
export interface SessionUnitState {
    createdAt: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    days: Record<string, number>;
    thinking: ThinkingLevelCounts;
    models: Record<string, number>;
    tools: Record<string, number>;
    skills: Record<string, number>;
    messageCount: number;
    lastMsgTime: number | null;
    segStart: number | null;
    maxSeg: number;
    effort: string | null;
    effortKnown: boolean;
    early: ThinkingLevelCounts;
    last: LastSettlement | null;
}
export interface SessionView {
    createdAt: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    days: Record<string, number>;
    thinking: ThinkingLevelCounts;
    models: Record<string, number>;
    tools: Record<string, number>;
    skills: Record<string, number>;
    messageCount: number;
    lastMsgTime: number | null;
    segStart: number | null;
    maxSeg: number;
}
export declare const CORE_TOOLS: Set<string>;
export declare function dayKey(time: number): string;
export declare function modelFamily(model: string): string;
export declare function thinkingLevel(reasoningTokens: number | undefined): keyof ThinkingLevelCounts;
export declare function effortBucket(effort: string | undefined | null): keyof ThinkingLevelCounts | undefined;
export declare function fmtDuration(sec: number): string;
export declare function streakDays(dateStrings: readonly string[]): [number, number];
export declare function createSessionState(header?: {
    createdAt?: unknown;
} | null): SessionUnitState;
export declare function applySessionEvent(state: SessionUnitState, event: {
    type?: unknown;
    time?: unknown;
    data?: unknown;
} | null | undefined): SessionUnitState;
export declare function sessionView(state: SessionUnitState): SessionView;
export declare function buildGlobalSnapshot(views: Iterable<SessionView>, progress: BackfillProgress): TokenUsageSnapshot;
