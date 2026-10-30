/**
 * 旧实现（git HEAD:src/index.ts）的独立参考移植。
 * 保持与旧代码相同的折叠/快照口径，仅去掉 DSH 运行时依赖。
 * 额外记录 per-session 工具/skill 计数，用于逐会话对拍（不影响全局快照）。
 */

export const USAGE_FIELDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']

export function zeroCounts() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

export function stepKey(sessionId, turn, step) {
  return sessionId + ':' + turn + ':' + step
}

export function dayKey(time) {
  const d = new Date(time)
  const pad = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

export function streakDays(dateStrings) {
  const days = [...new Set(dateStrings)].sort()
  if (days.length === 0) return [0, 0]
  const dayObjs = days.map((d) => new Date(d + 'T00:00:00'))
  let longest = 1
  let run = 1
  for (let i = 1; i < dayObjs.length; i++) {
    const gap = Math.round((dayObjs[i].getTime() - dayObjs[i - 1].getTime()) / 86400000)
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
      const gap = Math.round((dayObjs[i].getTime() - dayObjs[i - 1].getTime()) / 86400000)
      if (gap === 1) current += 1
      else break
    }
  }
  return [current, longest]
}

export function fmtDuration(sec) {
  sec = Math.floor(sec)
  if (sec <= 0) return '0分'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return d + '天 ' + (h % 24) + '小时'
  if (h > 0) return h + '小时 ' + m + '分'
  return m + '分'
}

export function modelFamily(model) {
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

export function thinkingLevel(reasoningTokens) {
  const r = reasoningTokens || 0
  if (r <= 0) return 'off'
  if (r <= 2000) return 'low'
  if (r <= 8000) return 'medium'
  return 'high'
}

export function effortBucket(effort) {
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

/** 旧 TokenUsageService 的无 I/O 复刻。 */
export class OldAggregator {
  constructor() {
    this.stepUsage = new Map()
    this.foldedSeq = new Map()
    this.toolCounts = new Map()
    this.skillCounts = new Map()
    this.sessionMeta = new Map()
    this.currentEffort = new Map()
    this.sessionTools = new Map()
    this.sessionSkills = new Map()
    // 用于差异归因的旁路统计（不影响快照）
    this.stats = {
      usageRecords: 0,
      messageUsageRecords: 0,
      chunkUsageRecords: 0,
      attempts: 0,
      retryStarted: 0,
      messagesWithoutDataUsage: 0,
      messagesStreamUsageFallback: 0,
    }
  }

  foldEvent(sessionId, event) {
    const data = event.data
    if (event.type === 'request/header') {
      const effort = data?.header?.config?.reasoningEffort
      if (typeof effort === 'string' && effort) this.currentEffort.set(sessionId, effort)
    } else if (event.type === 'assistant/chunk') {
      const chunk = data?.chunk
      if (chunk && chunk.type === 'usage' && chunk.usage) {
        const key = stepKey(sessionId, data.turn, data.step)
        this.stepUsage.set(key, {
          usage: chunk.usage, model: null, time: event.time, sessionId,
          effort: this.currentEffort.get(sessionId),
        })
        this.stats.usageRecords += 1
        this.stats.chunkUsageRecords += 1
      }
    } else if (event.type === 'assistant/message') {
      const usage = data?.usage
      if (usage) {
        const key = stepKey(sessionId, data.turn, data.step)
        const source = data?.message?.source
        const model = source && source.model ? String(source.model) : null
        this.stepUsage.set(key, {
          usage, model, time: event.time, sessionId,
          effort: this.currentEffort.get(sessionId),
        })
        this.stats.usageRecords += 1
        this.stats.messageUsageRecords += 1
      } else {
        this.stats.messagesWithoutDataUsage += 1
        const stream = data?.stream
        if (Array.isArray(stream) && stream.some((s) => s?.chunk?.type === 'usage' && s.chunk.usage)) {
          this.stats.messagesStreamUsageFallback += 1
        }
      }
      this.bumpMessage(sessionId, event.time)
    } else if (event.type === 'assistant/attempt') {
      this.stats.attempts += 1
    } else if (event.type === 'llm/retry-started') {
      this.stats.retryStarted += 1
    } else if (event.type === 'user/message') {
      this.bumpMessage(sessionId, event.time)
    } else if (event.type === 'tool/call') {
      const name = data?.name
      if (typeof name === 'string' && name) {
        if (name === 'skill') {
          let skillName = 'skill'
          try {
            const args = JSON.parse(String(data.arguments ?? '{}'))
            if (args && typeof args.name === 'string' && args.name) skillName = args.name
          } catch {}
          this.skillCounts.set(skillName, (this.skillCounts.get(skillName) ?? 0) + 1)
          const s = this.sessionSkills.get(sessionId) ?? {}
          s[skillName] = (s[skillName] ?? 0) + 1
          this.sessionSkills.set(sessionId, s)
        }
        this.toolCounts.set(name, (this.toolCounts.get(name) ?? 0) + 1)
        const t = this.sessionTools.get(sessionId) ?? {}
        t[name] = (t[name] ?? 0) + 1
        this.sessionTools.set(sessionId, t)
      }
    }
  }

  bumpMessage(sessionId, time) {
    const meta = this.sessionMeta.get(sessionId) ?? { createdAt: 0, messageCount: 0, lastMsgTime: null, segStart: null, maxSeg: 0 }
    meta.messageCount += 1
    if (meta.createdAt === 0) meta.createdAt = time
    if (meta.lastMsgTime == null) {
      meta.lastMsgTime = time
      meta.segStart = time
    } else {
      const gap = (time - meta.lastMsgTime) / 1000
      if (gap > 1800) {
        const segLen = (meta.lastMsgTime - meta.segStart) / 1000
        if (segLen > meta.maxSeg) meta.maxSeg = segLen
        meta.segStart = time
      }
      meta.lastMsgTime = time
    }
    this.sessionMeta.set(sessionId, meta)
  }

  /** 复刻 backfillSession（含首个 request/header 档位兜底）。 */
  backfillSession(sessionId, header, events) {
    let maxSeq = this.foldedSeq.get(sessionId) ?? -1
    const createdAt = header?.createdAt
    if (createdAt) {
      const existing = this.sessionMeta.get(sessionId)
      if (existing) existing.createdAt = createdAt
      else this.sessionMeta.set(sessionId, { createdAt, messageCount: 0, lastMsgTime: null, segStart: null, maxSeg: 0 })
    }
    for (const ev of events) {
      if (ev.type !== 'request/header') continue
      const e = ev.data?.header?.config?.reasoningEffort
      if (typeof e === 'string' && e) {
        this.currentEffort.set(sessionId, e)
        break
      }
    }
    for (const event of events) {
      if (typeof event.seq === 'number' && event.seq <= maxSeq) continue
      if (typeof event.seq === 'number') maxSeq = event.seq
      this.foldEvent(sessionId, event)
    }
    this.foldedSeq.set(sessionId, maxSeq)
  }

  longestChatSegment() {
    let maxSeg = 0
    for (const meta of this.sessionMeta.values()) {
      let seg = meta.maxSeg
      if (meta.lastMsgTime != null && meta.segStart != null) {
        const tail = (meta.lastMsgTime - meta.segStart) / 1000
        if (tail > seg) seg = tail
      }
      if (seg > maxSeg) maxSeg = seg
    }
    return maxSeg
  }

  /** 单个 session 在旧口径下的贡献（逐会话对拍用）。 */
  sessionContribution(sessionId) {
    const buckets = zeroCounts()
    const days = {}
    const thinking = { high: 0, medium: 0, low: 0, off: 0 }
    const models = {}
    let total = 0
    for (const record of this.stepUsage.values()) {
      if (record.sessionId !== sessionId) continue
      const usage = record.usage
      const recTotal = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
      for (const field of USAGE_FIELDS) buckets[field] += usage[field] ?? 0
      total += recTotal
      const day = dayKey(record.time)
      days[day] = (days[day] ?? 0) + recTotal
      const level = effortBucket(record.effort) ?? thinkingLevel(usage.reasoningTokens)
      thinking[level] += 1
      const fam = modelFamily(record.model ?? 'unknown')
      models[fam] = (models[fam] ?? 0) + 1
    }
    const meta = this.sessionMeta.get(sessionId) ?? null
    return {
      inputTokens: buckets.inputTokens,
      outputTokens: buckets.outputTokens,
      cacheReadTokens: buckets.cacheReadTokens,
      cacheWriteTokens: buckets.cacheWriteTokens,
      totalTokens: total,
      days,
      thinking,
      models,
      tools: this.sessionTools.get(sessionId) ?? {},
      skills: this.sessionSkills.get(sessionId) ?? {},
      messageCount: meta?.messageCount ?? 0,
      lastMsgTime: meta?.lastMsgTime ?? null,
      segStart: meta?.segStart ?? null,
      maxSeg: meta?.maxSeg ?? 0,
      createdAt: meta?.createdAt ?? 0,
      hasMeta: meta !== null,
    }
  }

  snapshot() {
    const totals = zeroCounts()
    const dailyTokens = new Map()
    const thinkingLevels = { high: 0, medium: 0, low: 0, off: 0 }
    const modelCounts = new Map()
    const sessionTotals = new Map()
    for (const record of this.stepUsage.values()) {
      const usage = record.usage
      const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
      for (const field of USAGE_FIELDS) totals[field] += usage[field] ?? 0
      const day = dayKey(record.time)
      dailyTokens.set(day, (dailyTokens.get(day) ?? 0) + total)
      const level = effortBucket(record.effort) ?? thinkingLevel(usage.reasoningTokens)
      thinkingLevels[level] += 1
      const model = record.model ?? 'unknown'
      modelCounts.set(modelFamily(model), (modelCounts.get(modelFamily(model)) ?? 0) + 1)
      sessionTotals.set(record.sessionId, (sessionTotals.get(record.sessionId) ?? 0) + total)
    }
    const peakTokens = sessionTotals.size ? Math.max(...sessionTotals.values()) : 0
    const sessionDates = []
    const sessionIdSet = new Set()
    for (const [id, meta] of this.sessionMeta) {
      sessionIdSet.add(id)
      const date = meta.createdAt ? new Date(meta.createdAt) : null
      if (date && !Number.isNaN(date.getTime())) sessionDates.push(dayKey(date.getTime()))
    }
    const [currentStreak, longestStreak] = streakDays(sessionDates)
    const maxDurationSec = this.longestChatSegment()
    const totalToolCalls = [...this.toolCounts.values()].reduce((a, b) => a + b, 0)
    const distinctTools = this.toolCounts.size
    const topPlugins = [...this.toolCounts.entries()]
      .filter(([name]) => !CORE_TOOLS.has(name))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
    const topSkills = [...this.skillCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    const totalSkillUses = [...this.skillCounts.values()].reduce((a, b) => a + b, 0)
    const distinctSkills = this.skillCounts.size
    const sortedDates = sessionDates.sort()
    const earliestDate = sortedDates[0] ?? ''
    const latestDate = sortedDates[sortedDates.length - 1] ?? ''
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
    }
  }
}
