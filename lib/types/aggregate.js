/* Built from src/aggregate.ts by scripts/build-lib.mjs — do not edit directly. */
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




/** 四类 usage 桶（DSH TokenUsage 口径）。 */







/** 上一笔结算（用于同一步的重试/覆盖去重与按天替换）。 */



                               

                           




/** 单会话投影状态：可持久化的有界聚合（plain JSON）。 */






                          


                  

                  

                      





                                       

                                                         

                                                     




/** 单会话视图（投影单元的 wire view，也是全局汇总的输入）。 */


















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

function num(value         )         {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** 时间戳 -> 'YYYY-MM-DD'（本地时区，与面板热力图一致）。 */
export function dayKey(time        )         {
  const d = new Date(time)
  const pad = (n        )         => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** provider model id -> 短族名（Codex 词汇）。 */
export function modelFamily(model        )         {
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
export function thinkingLevel(reasoningTokens                    )                            {
  const r = reasoningTokens || 0
  if (r <= 0) return 'off'
  if (r <= 2000) return 'low'
  if (r <= 8000) return 'medium'
  return 'high'
}

/** DSH 权威推理强度 -> 面板四档；undefined 表示档位未知。 */
export function effortBucket(effort                           )                                        {
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
export function fmtDuration(sec        )         {
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
export function streakDays(dateStrings                   )                   {
  const days = [...new Set(dateStrings)].sort()
  if (days.length === 0) return [0, 0]
  const dayObjs = days.map(d => new Date(`${d}T00:00:00`))
  let longest = 1
  let run = 1
  for (let i = 1; i < dayObjs.length; i++) {
    const gap = Math.round((dayObjs[i] .getTime() - dayObjs[i - 1] .getTime()) / 86400000)
    if (gap === 1) {
      run += 1
      if (run > longest) longest = run
    } else {
      run = 1
    }
  }
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const latest = dayObjs[dayObjs.length - 1]
  const todayGap = Math.round((today.getTime() - latest.getTime()) / 86400000)
  let current = 0
  if (todayGap <= 1) {
    current = 1
    for (let i = dayObjs.length - 1; i > 0; i--) {
      const gap = Math.round((dayObjs[i] .getTime() - dayObjs[i - 1] .getTime()) / 86400000)
      if (gap === 1) current += 1
      else break
    }
  }
  return [current, longest]
}

function zeroBuckets()               {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

function bucketsOf(usage         )                                                     {
  const u = (usage ?? {})
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

function bucketsEqual(left              , right              )          {
  return left.inputTokens === right.inputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens
}

function bucketTotal(b              )         {
  return b.inputTokens + b.outputTokens + b.cacheReadTokens + b.cacheWriteTokens
}

/** 读取 assistant stream 里最后一个 usage 样本（重试尝试的真实消耗）。 */
function lastStreamUsage(stream         )          {
  if (!stream || typeof stream !== 'object') return undefined
  const chunks = (stream                        ).chunks
  if (!Array.isArray(chunks)) return undefined
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i]
    if (chunk && chunk.type === 'usage' && chunk.usage) return chunk.usage
  }
  return undefined
}

/** 一笔结算应读取的 usage 样本（与 token-meter usageOf 一致）。 */
function usageOf(event                                  )          {
  const data = (event.data ?? {})
  if (event.type === 'assistant/message') {
    if (data.usage !== undefined) return data.usage
    return lastStreamUsage(data.stream)
  }
  if (event.type === 'assistant/attempt') return lastStreamUsage(data.stream)
  if (event.type === 'assistant/chunk') {
    const chunk = data.chunk
    if (chunk && chunk.type === 'usage' && chunk.usage) return chunk.usage
  }
  return undefined
}

/** 会话元数据骨架。 */
export function createSessionState(header                                 )                   {
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

function bumpMessage(state                  , time        )                   {
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

function incr(map                        , key        )                         {
  return { ...map, [key]: (map[key] ?? 0) + 1 }
}

function dropZero(map                        )                         {
  let clean = false
  for (const key of Object.keys(map)) {
    if (!map[key]) { clean = true; break }
  }
  if (!clean) return map
  const next                         = {}
  for (const [key, value] of Object.entries(map)) if (value) next[key] = value
  return next
}

/** 折叠一笔结算（同一步的重复样本按替换记账）。 */
function settle(
  state                  ,
  sample         ,
  turn        ,
  step        ,
  time        ,
  model                           ,
  modelKnown         ,
)                   {
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
export function applySessionEvent(state                  , event                                                                       )                   {
  if (!event || typeof event.type !== 'string') return state
  const type = event.type
  const data = (event.data ?? {})
  const time = num(event.time)

  if (type === 'request/header') {
    const header = data.header
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
      for (const key of ['high', 'medium', 'low', 'off']         ) {
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
    const message = data.message
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
          const args = JSON.parse(rawArgs)
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
export function sessionView(state                  )              {
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

/**
 * 合并多个会话视图 + 可选的历史基线为一个全局快照。
 *
 * 历史基线（`history`）是"已经丢失、只能从截图/外部记录补回"的时段汇总：
 * 累计/峰值/会话/消息/工具/时长直接相加或取较大值，日桶按日期相加，
 * 连续天数按合并后的活跃日期重算。基线没有提供的维度（thinking/模型明细）
 * 沿用真实会话的分布。没有基线时行为与旧实现完全一致。
 */
export function buildGlobalSnapshot(
  views                       ,
  progress                  ,
  history                         ,
)                     {
  const total = zeroBuckets()
  const daily = new Map                ()
  const thinking                      = { high: 0, medium: 0, low: 0, off: 0 }
  const models = new Map                ()
  const tools = new Map                ()
  const skills = new Map                ()
  const sessionDates           = []
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

  // 真实会话的汇总先算出来：基线里的"工具调用总数 / skill 总数"是包含自身 Top 明细的
  // 总量，不能和合并进 tools/skills 地图的次数重复相加。
  const realToolCalls = sumValues(tools)
  const realSkillUses = sumValues(skills)
  const activeDates = [...sessionDates]
  let historyInfo                             = null

  if (history) {
    for (const [day, value] of Object.entries(history.dailyTokens)) {
      daily.set(day, (daily.get(day) ?? 0) + value)
    }
    if (history.thinkingLevels) {
      thinking.high += history.thinkingLevels.high
      thinking.medium += history.thinkingLevels.medium
      thinking.low += history.thinkingLevels.low
      thinking.off += history.thinkingLevels.off
    }
    for (const [key, value] of Object.entries(history.modelBreakdown ?? {})) {
      models.set(key, (models.get(key) ?? 0) + value)
    }
    for (const [name, count] of history.topPlugins ?? []) tools.set(name, (tools.get(name) ?? 0) + count)
    for (const [name, count] of history.topSkills ?? []) skills.set(name, (skills.get(name) ?? 0) + count)
    sessions += history.totalConversations ?? 0
    messages += history.totalMessages ?? 0
    if ((history.peakTokens ?? 0) > peakTokens) peakTokens = history.peakTokens ?? 0
    if ((history.maxDurationSec ?? 0) > maxDurationSec) maxDurationSec = history.maxDurationSec ?? 0
    if (history.activeDates) activeDates.push(...history.activeDates)
    historyInfo = {
      label: history.label,
      range: [history.range[0], history.range[1]],
      totalTokens: history.totalTokens,
      estimatedDaily: history.dailyEstimated,
      importedAt: history.importedAt ?? 0,
    }
  }

  let [currentStreak, longestStreak] = streakDays(activeDates)
  if (history) {
    if ((history.currentStreak ?? 0) > currentStreak) currentStreak = history.currentStreak ?? 0
    if ((history.longestStreak ?? 0) > longestStreak) longestStreak = history.longestStreak ?? 0
  }

  const dateList = [...sessionDates]
  if (history) dateList.push(history.range[0], history.range[1])
  dateList.sort()
  const topPlugins                          = [...tools.entries()]
    .filter(([name]) => !CORE_TOOLS.has(name))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
  const topSkills                          = [...skills.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)

  return {
    totalConversations: sessions,
    totalMessages: messages,
    totalTokens: total.inputTokens + total.outputTokens + total.cacheReadTokens + total.cacheWriteTokens + (history?.totalTokens ?? 0),
    peakTokens,
    maxDurationSec,
    maxDurationText: fmtDuration(maxDurationSec),
    currentStreak,
    longestStreak,
    dailyTokens: Object.fromEntries(daily),
    thinkingLevels: thinking,
    totalToolCalls: realToolCalls + (history?.totalToolCalls ?? 0),
    distinctTools: Math.max(tools.size, history?.distinctTools ?? 0),
    topPlugins,
    topSkills,
    totalSkillUses: realSkillUses + (history?.totalSkillUses ?? 0),
    distinctSkills: Math.max(skills.size, history?.distinctSkills ?? 0),
    modelBreakdown: Object.fromEntries(models),
    earliestDate: dateList[0] ?? '',
    latestDate: dateList[dateList.length - 1] ?? '',
    updatedAt: Date.now(),
    backfill: { ...progress },
    history: historyInfo,
  }
}

/** 求一个计数表的合计。 */
function sumValues(map                     )         {
  let total = 0
  for (const value of map.values()) total += value
  return total
}


//# sourceURL=src/aggregate.ts