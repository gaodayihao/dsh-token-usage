/**
 * Token 统计面板 — 纯聚合模块（无 DSH 运行时依赖）
 *
 * 这个模块是 host 半边的“折叠引擎”，刻意不 import 任何 DSH 服务：
 *  - 投影单元（sessionProjections）的 apply 直接调它，DSH 负责增量驱动与持久化；
 *  - 兜底模式（没有投影服务的老 DSH）在插件自己的回放循环里调它；
 *  - 离线校验脚本也可以直接 import 它做对拍。
 *
 * 折叠语义对齐 DSH 内置 token-meter 的 `tokenUsage` 单元：
 *  - `assistant/message` 的 usage 是权威结算；
 *  - `assistant/attempt` 取 stream 内最后一个 usage 样本（重试尝试的真实消耗）；
 *  - `llm/retry-started` 复位 last 槽，使重试后的结算追加而不是覆盖；
 *  - 同一 (turn, step) 的重复样本按“替换”记账（差值计入总量），避免双计数；
 *  - 兼容旧 v3 日志的 `assistant/chunk` usage（v4 日志里不再出现）。
 *
 * 状态是有界的：只保留会话级汇总、按天 token 桶、工具/skill/模型计数和
 * 一条“上一笔结算”槽位，内存与“会话有多长”解耦。
 * @module @deepseek-ai/dsh-token-usage/aggregate
 */

import type { BackfillProgress, ThinkingLevelCounts, TokenUsageSnapshot } from './types.ts'

/** 四类 usage 桶（DSH TokenUsage 口径）。 */
export interface TokenBuckets {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** 上一笔结算（用于同一步的重试/覆盖去重与按天替换）。 */
export interface LastSettlement {
  turn: number
  step: number
  /** 该笔结算所在的本地日期 'YYYY-MM-DD'。 */
  day: string
  /** 该笔结算的 token 总量（四桶之和）。 */
  total: number
  buckets: TokenBuckets
}

/** 单会话投影状态：可持久化的有界聚合（plain JSON）。 */
export interface SessionUnitState {
  createdAt: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** 本地日期 -> 当日 token 总量。 */
  days: Record<string, number>
  thinking: ThinkingLevelCounts
  /** 模型族 -> 结算次数。 */
  models: Record<string, number>
  /** 工具名 -> 调用次数。 */
  tools: Record<string, number>
  /** skill 名 -> 使用次数。 */
  skills: Record<string, number>
  messageCount: number
  lastMsgTime: number | null
  segStart: number | null
  maxSeg: number
  /** 最近一次 request/header 生效的推理强度（权威值）。 */
  effort: string | null
  /** 是否已经拿到可映射的权威档位（false 时早期结算先按 reasoningTokens 近似记录）。 */
  effortKnown: boolean
  /** 权威档位出现前、按 reasoningTokens 近似的早期结算计数（拿到档位后整体迁移）。 */
  early: ThinkingLevelCounts
  last: LastSettlement | null
}

/** 单会话视图（投影单元的 wire view，也是全局汇总的输入）。 */
export interface SessionView {
  createdAt: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  days: Record<string, number>
  thinking: ThinkingLevelCounts
  models: Record<string, number>
  tools: Record<string, number>
  skills: Record<string, number>
  messageCount: number
  lastMsgTime: number | null
  segStart: number | null
  maxSeg: number
}

/** DSH 核心工具集：其余工具视为“插件”。 */
export const CORE_TOOLS = new Set([
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
])

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** 时间戳 -> 'YYYY-MM-DD'（本地时区，与面板热力图一致）。 */
export function dayKey(time: number): string {
  const d = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** provider model id -> 短族名（Codex 词汇）。 */
export function modelFamily(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('glm')) return 'GLM'
  if (m.includes('deepseek')) return 'DeepSeek'
  if (m.includes('gemini')) return 'Gemini'
  if (m.includes('claude')) return 'Claude'
  if (m.includes('kimi') || m.includes('k3')) return 'Kimi'
  if (m.includes('doubao') || m.includes('seed')) return 'Doubao'
  if (m.includes('qwen')) return 'Qwen'
  if (m.includes('minimax')) return 'MiniMax'
  if (m.includes('gpt')) return 'GPT'
  if (m.includes('llama')) return 'Llama'
  if (m.includes('mistral') || m.includes('codestral') || m.includes('devstral')) return 'Mistral'
  if (m.includes('mimo')) return 'MiMo'
  if (m.includes('command')) return 'Cohere'
  return m || 'Other'
}

/** reasoningTokens -> thinking 等级近似（仅在无 request/header 权威值时兜底）。 */
export function thinkingLevel(reasoningTokens: number | undefined): keyof ThinkingLevelCounts {
  const r = reasoningTokens || 0
  if (r <= 0) return 'off'
  if (r <= 2000) return 'low'
  if (r <= 8000) return 'medium'
  return 'high'
}

/** DSH 权威推理强度 -> 面板四档；undefined 表示档位未知。 */
export function effortBucket(effort: string | undefined | null): keyof ThinkingLevelCounts | undefined {
  if (!effort) return undefined
  switch (effort.toLowerCase()) {
    case 'off':
    case 'none':
      return 'off'
    case 'low':
    case 'minimal':
      return 'low'
    case 'medium':
      return 'medium'
    case 'high':
    case 'xhigh':
    case 'max':
    case 'ultra':
      return 'high'
    default:
      return undefined
  }
}

/** 秒 -> "x天 y小时" / "x小时 y分" / "x分"。 */
export function fmtDuration(sec: number): string {
  sec = Math.floor(sec)
  if (sec <= 0) return '0分'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}天 ${h % 24}小时`
  if (h > 0) return `${h}小时 ${m}分`
  return `${m}分`
}

/** 连续活跃天数（按 'YYYY-MM-DD' 去重排序）：返回 [当前连续（含今天/昨天）、历史最长连续]。 */
export function streakDays(dateStrings: readonly string[]): [number, number] {
  const days = [...new Set(dateStrings)].sort()
  if (days.length === 0) return [0, 0]
  const dayObjs = days.map(d => new Date(`${d}T00:00:00`))
  let longest = 1
  let run = 1
  for (let i = 1; i < dayObjs.length; i++) {
    const gap = Math.round((dayObjs[i]!.getTime() - dayObjs[i - 1]!.getTime()) / 86400000)
    if (gap === 1) {
      run += 1
      if (run > longest) longest = run
    } else {
      run = 1
    }
  }
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const latest = dayObjs[dayObjs.length - 1]!
  const todayGap = Math.round((today.getTime() - latest.getTime()) / 86400000)
  let current = 0
  if (todayGap <= 1) {
    current = 1
    for (let i = dayObjs.length - 1; i > 0; i--) {
      const gap = Math.round((dayObjs[i]!.getTime() - dayObjs[i - 1]!.getTime()) / 86400000)
      if (gap === 1) current += 1
      else break
    }
  }
  return [current, longest]
}

function zeroBuckets(): TokenBuckets {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

function bucketsOf(usage: unknown): { buckets: TokenBuckets; reasoningTokens: number } {
  const u = (usage ?? {}) as Record<string, unknown>
  return {
    buckets: {
      inputTokens: num(u.inputTokens),
      outputTokens: num(u.outputTokens),
      cacheReadTokens: num(u.cacheReadTokens),
      cacheWriteTokens: num(u.cacheWriteTokens),
    },
    reasoningTokens: num(u.reasoningTokens),
  }
}

function bucketsEqual(left: TokenBuckets, right: TokenBuckets): boolean {
  return left.inputTokens === right.inputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens
}

function bucketTotal(b: TokenBuckets): number {
  return b.inputTokens + b.outputTokens + b.cacheReadTokens + b.cacheWriteTokens
}

/** 读取 assistant stream 里最后一个 usage 样本（重试尝试的真实消耗）。 */
function lastStreamUsage(stream: unknown): unknown {
  if (!stream || typeof stream !== 'object') return undefined
  const chunks = (stream as { chunks?: unknown }).chunks
  if (!Array.isArray(chunks)) return undefined
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i] as { type?: unknown; usage?: unknown } | undefined
    if (chunk && chunk.type === 'usage' && chunk.usage) return chunk.usage
  }
  return undefined
}

/** 一笔结算应读取的 usage 样本（与 token-meter usageOf 一致）。 */
function usageOf(event: { type: string; data?: unknown }): unknown {
  const data = (event.data ?? {}) as Record<string, unknown>
  if (event.type === 'assistant/message') {
    if (data.usage !== undefined) return data.usage
    return lastStreamUsage(data.stream)
  }
  if (event.type === 'assistant/attempt') return lastStreamUsage(data.stream)
  if (event.type === 'assistant/chunk') {
    const chunk = data.chunk as { type?: string; usage?: unknown } | undefined
    if (chunk && chunk.type === 'usage' && chunk.usage) return chunk.usage
  }
  return undefined
}

/** 会话元数据骨架。 */
export function createSessionState(header?: { createdAt?: unknown } | null): SessionUnitState {
  return {
    createdAt: num(header?.createdAt),
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    days: {},
    thinking: { high: 0, medium: 0, low: 0, off: 0 },
    models: {},
    tools: {},
    skills: {},
    messageCount: 0,
    lastMsgTime: null,
    segStart: null,
    maxSeg: 0,
    effort: null,
    effortKnown: false,
    early: { high: 0, medium: 0, low: 0, off: 0 },
    last: null,
  }
}

function bumpMessage(state: SessionUnitState, time: number): SessionUnitState {
  const messageCount = state.messageCount + 1
  if (state.lastMsgTime == null || state.segStart == null) {
    return { ...state, messageCount, lastMsgTime: time, segStart: time }
  }
  let maxSeg = state.maxSeg
  let segStart = state.segStart
  const gap = (time - state.lastMsgTime) / 1000
  if (gap > 1800) {
    const segLen = (state.lastMsgTime - segStart) / 1000
    if (segLen > maxSeg) maxSeg = segLen
    segStart = time
  }
  return { ...state, messageCount, lastMsgTime: time, segStart, maxSeg }
}

function incr(map: Record<string, number>, key: string): Record<string, number> {
  return { ...map, [key]: (map[key] ?? 0) + 1 }
}

function dropZero(map: Record<string, number>): Record<string, number> {
  let clean = false
  for (const key of Object.keys(map)) {
    if (!map[key]) { clean = true; break }
  }
  if (!clean) return map
  const next: Record<string, number> = {}
  for (const [key, value] of Object.entries(map)) if (value) next[key] = value
  return next
}

/** 折叠一笔结算（同一步的重复样本按替换记账）。 */
function settle(
  state: SessionUnitState,
  sample: unknown,
  turn: number,
  step: number,
  time: number,
  model: string | null | undefined,
  modelKnown: boolean,
): SessionUnitState {
  const { buckets, reasoningTokens } = bucketsOf(sample)
  const previous = state.last !== null && state.last.turn === turn && state.last.step === step ? state.last : null
  if (previous && bucketsEqual(previous.buckets, buckets)) return state
  const total = bucketTotal(buckets)
  const day = dayKey(time)
  const days = { ...state.days }
  if (previous && previous.day !== day) {
    days[previous.day] = (days[previous.day] ?? 0) - previous.total
  }
  days[day] = (days[day] ?? 0) + total
  const nextDays = dropZero(days)

  let thinking = state.thinking
  let models = state.models
  let early = state.early
  if (!previous) {
    thinking = { ...state.thinking }
    if (state.effortKnown) {
      thinking[effortBucket(state.effort) ?? thinkingLevel(reasoningTokens)] += 1
    } else {
      // 权威档位还没出现：先按 reasoningTokens 近似记录，同时记进 early 桶；
      // 一旦拿到可映射的档位，early 计数会整体迁移过去（与旧实现的前置扫描一致）。
      const level = thinkingLevel(reasoningTokens)
      thinking[level] += 1
      early = { ...state.early }
      early[level] += 1
    }
    if (modelKnown) models = incr(state.models, modelFamily(model ?? 'unknown'))
  }

  return {
    ...state,
    inputTokens: state.inputTokens - (previous?.buckets.inputTokens ?? 0) + buckets.inputTokens,
    outputTokens: state.outputTokens - (previous?.buckets.outputTokens ?? 0) + buckets.outputTokens,
    cacheReadTokens: state.cacheReadTokens - (previous?.buckets.cacheReadTokens ?? 0) + buckets.cacheReadTokens,
    cacheWriteTokens: state.cacheWriteTokens - (previous?.buckets.cacheWriteTokens ?? 0) + buckets.cacheWriteTokens,
    days: nextDays,
    thinking,
    models,
    early,
    last: { turn, step, day, total, buckets },
  }
}

/** 折叠一条 session 事件，返回新状态（纯函数；未变化的事件返回原 state 引用）。 */
export function applySessionEvent(state: SessionUnitState, event: { type?: unknown; time?: unknown; data?: unknown } | null | undefined): SessionUnitState {
  if (!event || typeof event.type !== 'string') return state
  const type = event.type
  const data = (event.data ?? {}) as Record<string, unknown>
  const time = num(event.time)

  if (type === 'request/header') {
    const header = data.header as { config?: { reasoningEffort?: unknown } } | undefined
    const effort = header?.config?.reasoningEffort
    if (typeof effort === 'string' && effort) {
      if (state.effortKnown || state.effort === effort) {
        return state.effort === effort ? state : { ...state, effort }
      }
      const bucket = effortBucket(effort)
      if (bucket === undefined) return { ...state, effort }
      // 旧实现会先用“整条日志里第一个明确档位”给最早的几步兜底；这里在拿到
      // 可映射档位时把早期近似计数整体迁移过去，得到同样的分类。
      const thinking = { ...state.thinking }
      const early = state.early
      const earlyTotal = early.high + early.medium + early.low + early.off
      for (const key of ['high', 'medium', 'low', 'off'] as const) {
        if (early[key] > 0) thinking[key] -= early[key]
      }
      thinking[bucket] += earlyTotal
      return {
        ...state,
        effort,
        effortKnown: true,
        thinking,
        early: { high: 0, medium: 0, low: 0, off: 0 },
      }
    }
    return state
  }

  if (type === 'llm/retry-started') {
    const turn = num(data.turn)
    const step = num(data.step)
    if (state.last !== null && state.last.turn === turn && state.last.step === step) {
      return { ...state, last: null }
    }
    return state
  }

  if (type === 'assistant/message' || type === 'assistant/attempt' || type === 'assistant/chunk') {
    const sample = usageOf({ type, data })
    if (sample === undefined) {
      return type === 'assistant/message' ? bumpMessage(state, time) : state
    }
    const turn = num(data.turn)
    const step = num(data.step)
    const message = data.message as { source?: { model?: unknown } } | undefined
    const rawModel = message?.source?.model
    const model = typeof rawModel === 'string' && rawModel ? rawModel : null
    let next = settle(state, sample, turn, step, time, model, type !== 'assistant/attempt')
    if (type === 'assistant/message') next = bumpMessage(next, time)
    return next
  }

  if (type === 'user/message') return bumpMessage(state, time)

  if (type === 'tool/call') {
    const name = data.name
    if (typeof name !== 'string' || !name) return state
    let skills = state.skills
    if (name === 'skill') {
      let skillName = 'skill'
      const rawArgs = data.arguments
      if (typeof rawArgs === 'string') {
        try {
          const args = JSON.parse(rawArgs) as { name?: unknown } | null
          if (args && typeof args.name === 'string' && args.name) skillName = args.name
        } catch {
          // keep generic name
        }
      }
      skills = incr(state.skills, skillName)
    }
    return { ...state, tools: incr(state.tools, name), skills }
  }

  return state
}

/** 单会话状态 -> wire view（投影单元与全局汇总共用）。 */
export function sessionView(state: SessionUnitState): SessionView {
  return {
    createdAt: state.createdAt,
    totalTokens: state.inputTokens + state.outputTokens + state.cacheReadTokens + state.cacheWriteTokens,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    cacheReadTokens: state.cacheReadTokens,
    cacheWriteTokens: state.cacheWriteTokens,
    days: { ...state.days },
    thinking: { ...state.thinking },
    models: { ...state.models },
    tools: { ...state.tools },
    skills: { ...state.skills },
    messageCount: state.messageCount,
    lastMsgTime: state.lastMsgTime,
    segStart: state.segStart,
    maxSeg: state.maxSeg,
  }
}

/** 合并多个会话视图为一个全局快照（与旧实现同口径 + 回填进度）。 */
export function buildGlobalSnapshot(views: Iterable<SessionView>, progress: BackfillProgress): TokenUsageSnapshot {
  const total = zeroBuckets()
  const daily = new Map<string, number>()
  const thinking: ThinkingLevelCounts = { high: 0, medium: 0, low: 0, off: 0 }
  const models = new Map<string, number>()
  const tools = new Map<string, number>()
  const skills = new Map<string, number>()
  const sessionDates: string[] = []
  let sessions = 0
  let messages = 0
  let peakTokens = 0
  let maxDurationSec = 0

  for (const view of views) {
    sessions += 1
    total.inputTokens += view.inputTokens
    total.outputTokens += view.outputTokens
    total.cacheReadTokens += view.cacheReadTokens
    total.cacheWriteTokens += view.cacheWriteTokens
    messages += view.messageCount
    if (view.totalTokens > peakTokens) peakTokens = view.totalTokens
    for (const [day, value] of Object.entries(view.days)) daily.set(day, (daily.get(day) ?? 0) + value)
    thinking.high += view.thinking.high
    thinking.medium += view.thinking.medium
    thinking.low += view.thinking.low
    thinking.off += view.thinking.off
    for (const [key, value] of Object.entries(view.models)) models.set(key, (models.get(key) ?? 0) + value)
    for (const [key, value] of Object.entries(view.tools)) tools.set(key, (tools.get(key) ?? 0) + value)
    for (const [key, value] of Object.entries(view.skills)) skills.set(key, (skills.get(key) ?? 0) + value)
    if (view.createdAt) sessionDates.push(dayKey(view.createdAt))
    let seg = view.maxSeg
    if (view.lastMsgTime != null && view.segStart != null) {
      const tail = (view.lastMsgTime - view.segStart) / 1000
      if (tail > seg) seg = tail
    }
    if (seg > maxDurationSec) maxDurationSec = seg
  }

  const [currentStreak, longestStreak] = streakDays(sessionDates)
  const sortedDates = sessionDates.sort()
  const topPlugins: Array<[string, number]> = [...tools.entries()]
    .filter(([name]) => !CORE_TOOLS.has(name))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
  const topSkills: Array<[string, number]> = [...skills.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
  let totalToolCalls = 0
  for (const value of tools.values()) totalToolCalls += value
  let totalSkillUses = 0
  for (const value of skills.values()) totalSkillUses += value

  return {
    totalConversations: sessions,
    totalMessages: messages,
    totalTokens: total.inputTokens + total.outputTokens + total.cacheReadTokens + total.cacheWriteTokens,
    peakTokens,
    maxDurationSec,
    maxDurationText: fmtDuration(maxDurationSec),
    currentStreak,
    longestStreak,
    dailyTokens: Object.fromEntries(daily),
    thinkingLevels: thinking,
    totalToolCalls,
    distinctTools: tools.size,
    topPlugins,
    topSkills,
    totalSkillUses,
    distinctSkills: skills.size,
    modelBreakdown: Object.fromEntries(models),
    earliestDate: sortedDates[0] ?? '',
    latestDate: sortedDates[sortedDates.length - 1] ?? '',
    updatedAt: Date.now(),
    backfill: { ...progress },
  }
}
