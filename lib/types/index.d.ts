/**
 * Token 统计面板 — Host 半边类型声明。
 * 实现见 lib/types/index.js（由 src/index.ts 经 scripts/build-lib.mjs 生成）。
 * @module @deepseek-ai/dsh-token-usage
 */
import { Context, Service } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { TokenUsageSnapshot } from './types.ts';
export type * from './types.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        tokenUsage: TokenUsageService;
    }
}
/**
 * 只读统计服务：维护“每会话有界聚合 -> 全局汇总”的内存 rollup，并通过 Typert Remote
 * 暴露给浏览器面板。不创建、不恢复任何 Agent / Session。
 */
export declare class TokenUsageService extends TypertRemoteService {
    static inject: string[];
    constructor(ctx: Context);
    protected [Service.init](): Promise<void>;
    getStats(): TokenUsageSnapshot;
}
export default TokenUsageService;
