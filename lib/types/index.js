/**
 * Token 统计面板 — Host 半边（Session Gallery 风格）
 *
 * 仿照 OpenClaw Session Gallery 统计面板（Codex 个人用量页风格）的数据口径，
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
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { Service } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
const USAGE_FIELDS = [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
];
/** 全零计数（避免每次 snapshot 重新造对象）。 */
function zeroCounts() {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}
/** 每 step 记录键。 */
function stepKey(sessionId, turn, step) {
    return `${sessionId}:${turn}:${step}`;
}
/** 时间戳 -> 'YYYY-MM-DD'。 */
function dayKey(time) {
    const d = new Date(time);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/**
 * 连续活跃天数（按 'YYYY-MM-DD' 去重排序）：
 * 返回 [当前连续（含今天/昨天）、历史最长连续]。
 */
function streakDays(dateStrings) {
    const days = [...new Set(dateStrings)].sort();
    if (days.length === 0)
        return [0, 0];
    const dayObjs = days.map(d => new Date(`${d}T00:00:00`));
    let longest = 1;
    let run = 1;
    for (let i = 1; i < dayObjs.length; i++) {
        const gap = Math.round((dayObjs[i].getTime() - dayObjs[i - 1].getTime()) / 86400000);
        if (gap === 1) {
            run += 1;
            if (run > longest)
                longest = run;
        }
        else {
            run = 1;
        }
    }
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const latest = dayObjs[dayObjs.length - 1];
    const todayGap = Math.round((today.getTime() - latest.getTime()) / 86400000);
    let current = 0;
    if (todayGap <= 1) {
        current = 1;
        for (let i = dayObjs.length - 1; i > 0; i--) {
            const gap = Math.round((dayObjs[i].getTime() - dayObjs[i - 1].getTime()) / 86400000);
            if (gap === 1)
                current += 1;
            else
                break;
        }
    }
    return [current, longest];
}
/** 秒 -> "x天 y小时" / "x小时 y分" / "x分"。 */
function fmtDuration(sec) {
    sec = Math.floor(sec);
    if (sec <= 0)
        return '0分';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const d = Math.floor(h / 24);
    if (d > 0)
        return `${d}天 ${h % 24}小时`;
    if (h > 0)
        return `${h}小时 ${m}分`;
    return `${m}分`;
}
/** provider model id -> 短族名（Session Gallery 词汇）。 */
function modelFamily(model) {
    const m = model.toLowerCase();
    if (m.includes('glm'))
        return 'GLM';
    if (m.includes('deepseek'))
        return 'DeepSeek';
    if (m.includes('gemini'))
        return 'Gemini';
    if (m.includes('claude'))
        return 'Claude';
    if (m.includes('kimi') || m.includes('k3'))
        return 'Kimi';
    if (m.includes('doubao') || m.includes('seed'))
        return 'Doubao';
    if (m.includes('qwen'))
        return 'Qwen';
    if (m.includes('minimax'))
        return 'MiniMax';
    if (m.includes('gpt'))
        return 'GPT';
    if (m.includes('llama'))
        return 'Llama';
    if (m.includes('mistral') || m.includes('codestral') || m.includes('devstral'))
        return 'Mistral';
    if (m.includes('mimo'))
        return 'MiMo';
    if (m.includes('command'))
        return 'Cohere';
    return m || 'Other';
}
/** reasoningTokens -> thinking 等级近似。 */
function thinkingLevel(reasoningTokens) {
    const r = reasoningTokens || 0;
    if (r <= 0)
        return 'off';
    if (r <= 2000)
        return 'low';
    if (r <= 8000)
        return 'medium';
    return 'high';
}
/** DSH 核心工具集：其余工具视为"插件"。 */
const CORE_TOOLS = new Set([
    'bash', 'read', 'read_image', 'write', 'edit', 'glob', 'grep', 'todo_write', 'ask_user_question',
    'subagent', 'subagent_fork', 'interrupt_agent', 'list_agents', 'send_message',
    'job_kill', 'job_list', 'job_output',
    'workflow', 'ralph', 'create_goal', 'get_goal', 'update_goal', 'exit_plan_mode',
    'web_search', 'session_search', 'session_event_search', 'session_event_read', 'session_event_trace', 'session_trace',
    'schedule_create', 'schedule_list', 'schedule_delete', 'skill',
    'cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine',
    'cordis_inspect_list', 'cordis_inspect_query', 'cordis_inspect_self',
    'mcp__reference_memory__read_graph', 'mcp__reference_memory__search_nodes',
    'mcp__reference_memory__open_nodes', 'mcp__reference_memory__create_entities',
    'mcp__reference_memory__add_observations', 'mcp__reference_memory__create_relations',
    'mcp__reference_memory__delete_entities', 'mcp__reference_memory__delete_observations',
    'mcp__reference_memory__delete_relations',
]);
/**
 * 只读统计服务：跨全部持久化 session 聚合 token 用量并实时跟随，通过
 * Typert Remote 暴露给浏览器面板。不创建、不恢复任何 Agent / Session。
 */
let TokenUsageService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _getStats_decorators;
    return class TokenUsageService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _getStats_decorators = [Remote('getStats')];
            __esDecorate(this, null, _getStats_decorators, { kind: "method", name: "getStats", static: false, private: false, access: { has: obj => "getStats" in obj, get: obj => obj.getStats }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static inject = ['sessionPersistence'];
        /** stepUsage: key `${sessionId}:${turn}:${step}` -> 折叠后的 usage 记录。 */
        stepUsage = (__runInitializers(this, _instanceExtraInitializers), new Map());
        /** foldedSeq: sessionId -> 已折叠的最高持久 seq（backfill/live 去重）。 */
        foldedSeq = new Map();
        /** pending: sessionId -> 该 session backfill 完成前缓冲的 live 事件。 */
        pending = new Map();
        /** 一旦为 true，新 session 的 live 事件直接折叠（不再缓冲）。 */
        backfillDone = false;
        /** toolCounts: 工具名 -> 调用次数。 */
        toolCounts = new Map();
        /** skillCounts: skill 名 -> 调用次数（从 'skill' 工具参数解析）。 */
        skillCounts = new Map();
        /** sessionMeta: sessionId -> 消息时间线元数据。 */
        sessionMeta = new Map();
        /**
         * @param ctx - Host context carrying session persistence.
         */
        constructor(ctx) {
            super(ctx, 'tokenUsage');
        }
        /** 挂载 live 订阅并启动历史回填（后台进行，不阻塞激活）。 */
        async [Service.init]() {
            const sp = this.ctx.sessionPersistence;
            const offLive = this.ctx.on('session/event', (session, event) => {
                const sessionId = session.id;
                if (!sessionId || typeof event.seq !== 'number')
                    return;
                if (this.backfillDone || this.foldedSeq.has(sessionId)) {
                    this.foldNew(sessionId, event);
                }
                else {
                    const list = this.pending.get(sessionId) ?? [];
                    list.push(event);
                    this.pending.set(sessionId, list);
                }
            });
            this.ctx.effect(() => () => {
                offLive();
            }, 'dsh-token-usage: live subscription');
            void this.runBackfill(sp);
        }
        /** 折叠一条 session 事件（usage / 消息时间线 / 工具与 skill 计数）。 */
        foldEvent(sessionId, event) {
            const data = event.data;
            if (event.type === 'assistant/chunk') {
                const chunk = data && data.chunk;
                if (chunk && chunk.type === 'usage' && chunk.usage) {
                    const key = stepKey(sessionId, data.turn, data.step);
                    this.stepUsage.set(key, { usage: chunk.usage, model: null, time: event.time, sessionId });
                }
            }
            else if (event.type === 'assistant/message') {
                const usage = data && data.usage;
                if (usage) {
                    const key = stepKey(sessionId, data.turn, data.step);
                    const source = data && data.message?.source;
                    const model = source && source.model ? String(source.model) : null;
                    this.stepUsage.set(key, { usage, model, time: event.time, sessionId });
                }
                this.bumpMessage(sessionId, event.time);
            }
            else if (event.type === 'user/message') {
                this.bumpMessage(sessionId, event.time);
            }
            else if (event.type === 'tool/call') {
                const name = data && data.name;
                if (typeof name === 'string' && name) {
                    // Skill 使用统计：'skill' 工具调用，arguments 是 JSON 字符串 {"name": "..."}
                    if (name === 'skill') {
                        let skillName = 'skill';
                        try {
                            const args = JSON.parse(String(data.arguments ?? '{}'));
                            if (args && typeof args.name === 'string' && args.name)
                                skillName = args.name;
                        }
                        catch {
                            // keep generic name
                        }
                        this.skillCounts.set(skillName, (this.skillCounts.get(skillName) ?? 0) + 1);
                    }
                    this.toolCounts.set(name, (this.toolCounts.get(name) ?? 0) + 1);
                }
            }
        }
        /** 延长会话消息时间线；>30min 间隔切分（Codex 风格）。 */
        bumpMessage(sessionId, time) {
            const meta = this.sessionMeta.get(sessionId) ?? { createdAt: 0, messageCount: 0, lastMsgTime: null, segStart: null, maxSeg: 0 };
            meta.messageCount += 1;
            if (meta.createdAt === 0)
                meta.createdAt = time;
            if (meta.lastMsgTime == null) {
                meta.lastMsgTime = time;
                meta.segStart = time;
            }
            else {
                const gap = (time - meta.lastMsgTime) / 1000;
                if (gap > 1800) {
                    const segLen = (meta.lastMsgTime - meta.segStart) / 1000;
                    if (segLen > meta.maxSeg)
                        meta.maxSeg = segLen;
                    meta.segStart = time;
                }
                meta.lastMsgTime = time;
            }
            this.sessionMeta.set(sessionId, meta);
        }
        /** 只折叠比会话游标更新的事件。 */
        foldNew(sessionId, event) {
            const maxSeq = this.foldedSeq.get(sessionId) ?? -1;
            if (event.seq <= maxSeq)
                return;
            this.foldedSeq.set(sessionId, event.seq);
            this.foldEvent(sessionId, event);
        }
        /** 回填完成后，按序消化该 session 缓冲的 live 事件。 */
        drainPending(sessionId) {
            const buffered = this.pending.get(sessionId);
            if (!buffered)
                return;
            this.pending.delete(sessionId);
            for (const event of buffered)
                this.foldNew(sessionId, event);
        }
        /** 回填一个 session 的持久日志，然后消化其缓冲事件。 */
        async backfillSession(sp, sessionId) {
            let maxSeq = this.foldedSeq.get(sessionId) ?? -1;
            const { meta, events } = await sp.inspect(sessionId);
            if (meta && meta.createdAt) {
                const existing = this.sessionMeta.get(sessionId);
                if (existing)
                    existing.createdAt = meta.createdAt;
                else
                    this.sessionMeta.set(sessionId, { createdAt: meta.createdAt, messageCount: 0, lastMsgTime: null, segStart: null, maxSeg: 0 });
            }
            for (const event of events) {
                if (event.seq <= maxSeq)
                    continue;
                maxSeq = event.seq;
                this.foldEvent(sessionId, event);
            }
            this.foldedSeq.set(sessionId, maxSeq);
            this.drainPending(sessionId);
        }
        /** 启动历史回填；持久化服务缺失时退化为仅实时累计。 */
        async runBackfill(sp) {
            if (!sp || typeof sp.list !== 'function' || typeof sp.inspect !== 'function') {
                console.warn('[token-usage] sessionPersistence unavailable — live accumulation only');
                this.backfillDone = true;
                return;
            }
            try {
                const headers = await sp.list();
                for (const header of headers) {
                    try {
                        await this.backfillSession(sp, header.id);
                    }
                    catch (error) {
                        console.warn(`[token-usage] backfill failed for ${header.id}: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            }
            catch (error) {
                console.warn(`[token-usage] session list failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            for (const sessionId of [...this.pending.keys()]) {
                this.foldedSeq.set(sessionId, -1);
                this.drainPending(sessionId);
            }
            this.backfillDone = true;
        }
        /** 各会话最长聊天段的最大值（>30min 间隔切分）。 */
        longestChatSegment() {
            let maxSeg = 0;
            for (const meta of this.sessionMeta.values()) {
                let seg = meta.maxSeg;
                if (meta.lastMsgTime != null && meta.segStart != null) {
                    const tail = (meta.lastMsgTime - meta.segStart) / 1000;
                    if (tail > seg)
                        seg = tail;
                }
                if (seg > maxSeg)
                    maxSeg = seg;
            }
            return maxSeg;
        }
        /** 构建 JSON 可序列化的聚合快照。 */
        snapshot() {
            const totals = zeroCounts();
            const dailyTokens = new Map();
            const thinkingLevels = { high: 0, medium: 0, low: 0, off: 0 };
            const modelCounts = new Map();
            const sessionTotals = new Map();
            for (const record of this.stepUsage.values()) {
                const usage = record.usage;
                const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
                    + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
                for (const field of USAGE_FIELDS)
                    totals[field] += usage[field] ?? 0;
                const day = dayKey(record.time);
                dailyTokens.set(day, (dailyTokens.get(day) ?? 0) + total);
                const level = thinkingLevel(usage.reasoningTokens);
                thinkingLevels[level] += 1;
                const model = record.model ?? 'unknown';
                const fam = modelFamily(model);
                modelCounts.set(fam, (modelCounts.get(fam) ?? 0) + 1);
                sessionTotals.set(record.sessionId, (sessionTotals.get(record.sessionId) ?? 0) + total);
            }
            const peakTokens = sessionTotals.size ? Math.max(...sessionTotals.values()) : 0;
            const sessionDates = [];
            const sessionIdSet = new Set();
            for (const [id, meta] of this.sessionMeta) {
                sessionIdSet.add(id);
                const date = meta.createdAt ? new Date(meta.createdAt) : null;
                if (date && !Number.isNaN(date.getTime())) {
                    sessionDates.push(dayKey(date.getTime()));
                }
            }
            const [currentStreak, longestStreak] = streakDays(sessionDates);
            const maxDurationSec = this.longestChatSegment();
            const totalToolCalls = [...this.toolCounts.values()].reduce((a, b) => a + b, 0);
            const distinctTools = this.toolCounts.size;
            const topPlugins = [...this.toolCounts.entries()]
                .filter(([name]) => !CORE_TOOLS.has(name))
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5);
            const topSkills = [...this.skillCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
            const totalSkillUses = [...this.skillCounts.values()].reduce((a, b) => a + b, 0);
            const distinctSkills = this.skillCounts.size;
            const sortedDates = sessionDates.sort();
            const earliestDate = sortedDates[0] ?? '';
            const latestDate = sortedDates[sortedDates.length - 1] ?? '';
            return {
                totalConversations: sessionIdSet.size,
                totalMessages: [...this.sessionMeta.values()].reduce((a, m) => a + m.messageCount, 0),
                totalTokens: totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens,
                peakTokens,
                maxDurationSec,
                maxDurationText: fmtDuration(maxDurationSec),
                currentStreak,
                longestStreak,
                dailyTokens: Object.fromEntries(dailyTokens),
                thinkingLevels,
                totalToolCalls,
                distinctTools,
                topPlugins,
                topSkills,
                totalSkillUses,
                distinctSkills,
                modelBreakdown: Object.fromEntries(modelCounts),
                earliestDate,
                latestDate,
                updatedAt: Date.now(),
            };
        }
        /**
         * 读取当前聚合快照。
         * @returns 全部 session 的 token 用量汇总（纯 JSON）。
         */
        getStats() {
            return this.snapshot();
        }
    };
})();
export { TokenUsageService };
export default TokenUsageService;
//# sourceMappingURL=index.js.map