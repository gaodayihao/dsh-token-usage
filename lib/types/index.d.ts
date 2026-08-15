/**
 * Token 统计面板 — Host 半边（Codex 风格）
 *
 * 仿照 Codex 个人用量页统计面板的数据口径，
 * 后端逻辑完全基于 DSH 原生数据：
 *  - Backfill：激活时通过 `ctx.sessionPersistence.list()/inspect()` 枚举每个持久化
 *    session，从存储事件折叠 usage / 工具调用 / 消息时间线，面板覆盖历史。
 *  - Live：订阅 `session/event`，把同样的信号实时折叠进来。
 *  - RPC：`@Remote('getStats')` 把聚合快照通过 Typert Remote 暴露给浏览器半边
 *    （client 侧通过通用 RPC 通道调用 `tokenUsage/getStats`）。
 *
 * 记账语义（与 token-meter 折叠一致）：
 *  - 每 step 一条 usage 记录，键为 `${sessionId}:${turn}:${step}`。
 *  - `assistant/chunk`（chunk.type === 'usage'）是每 step 的持久记录；
 *    `assistant/message` 携带 usage 时以同键覆盖 chunk 记录（last writer wins，
 *    不重复计数），并携带 `message.source.model`。
 *
 * 与 OpenClaw 版的差异：DSH 无火山平台真实总量（GLM）校准，累计 token 直接取
 * provider 返回的 usage（input + output + cacheRead + cacheWrite）；thinking 等级
 * 由 reasoningTokens 近似。
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
 * 只读统计服务：跨全部持久化 session 聚合 token 用量并实时跟随，通过
 * Typert Remote 暴露给浏览器面板。不创建、不恢复任何 Agent / Session。
 */
export declare class TokenUsageService extends TypertRemoteService {
    static inject: string[];
    /** stepUsage: key `${sessionId}:${turn}:${step}` -> 折叠后的 usage 记录。 */
    private readonly stepUsage;
    /** foldedSeq: sessionId -> 已折叠的最高持久 seq（backfill/live 去重）。 */
    private readonly foldedSeq;
    /** pending: sessionId -> 该 session backfill 完成前缓冲的 live 事件。 */
    private readonly pending;
    /** 一旦为 true，新 session 的 live 事件直接折叠（不再缓冲）。 */
    private backfillDone;
    /** toolCounts: 工具名 -> 调用次数。 */
    private readonly toolCounts;
    /** skillCounts: skill 名 -> 调用次数（从 'skill' 工具参数解析）。 */
    private readonly skillCounts;
    /** sessionMeta: sessionId -> 消息时间线元数据。 */
    private readonly sessionMeta;
    /**
     * @param ctx - Host context carrying session persistence.
     */
    constructor(ctx: Context);
    /** 挂载 live 订阅并启动历史回填（后台进行，不阻塞激活）。 */
    protected [Service.init](): Promise<void>;
    /** 折叠一条 session 事件（usage / 消息时间线 / 工具与 skill 计数）。 */
    private foldEvent;
    /** 延长会话消息时间线；>30min 间隔切分（Codex 风格）。 */
    private bumpMessage;
    /** 只折叠比会话游标更新的事件。 */
    private foldNew;
    /** 回填完成后，按序消化该 session 缓冲的 live 事件。 */
    private drainPending;
    /** 回填一个 session 的持久日志，然后消化其缓冲事件。 */
    private backfillSession;
    /** 启动历史回填；持久化服务缺失时退化为仅实时累计。 */
    private runBackfill;
    /** 各会话最长聊天段的最大值（>30min 间隔切分）。 */
    private longestChatSegment;
    /** 构建 JSON 可序列化的聚合快照。 */
    private snapshot;
    /**
     * 读取当前聚合快照。
     * @returns 全部 session 的 token 用量汇总（纯 JSON）。
     */
    getStats(): TokenUsageSnapshot;
}
export default TokenUsageService;
//# sourceMappingURL=index.d.ts.map