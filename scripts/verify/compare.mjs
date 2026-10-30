/**
 * 旧实现（旧 Aggregator）vs 新实现（src/aggregate.ts）对拍。
 *
 * 用法：
 *   node scripts/verify/compare.mjs                # 均匀抽样 30 个会话
 *   node scripts/verify/compare.mjs --limit 0      # 全量
 *   node scripts/verify/compare.mjs --limit 100 --detail 60 --json
 */
import { listSessionFiles, loadSession } from './sessions.mjs'
import { OldAggregator } from './old-ref.mjs'
import { createSessionState, applySessionEvent, sessionView, buildGlobalSnapshot } from '../../src/aggregate.ts'

const argv = process.argv.slice(2)
function arg(name, fallback) {
  const i = argv.indexOf('--' + name)
  if (i < 0) return fallback
  const v = argv[i + 1]
  if (v === undefined || v.startsWith('--')) return true
  return v
}
const LIMIT = Number(arg('limit', 30))
const DETAIL = Number(arg('detail', 30))
const AS_JSON = arg('json', false) === true
const ROOT = String(arg('root', 'C:/Users/Ellis/.dsh/sessions'))

import { readFileSync } from 'node:fs'
const ONLY = arg('only', null)
let files = listSessionFiles(ROOT)
if (typeof ONLY === 'string') {
  files = readFileSync(ONLY, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
}
const total = LIMIT === 0 ? files.length : Math.min(LIMIT, files.length)
const step = LIMIT === 0 || total >= files.length ? 1 : files.length / total
const picked = []
for (let i = 0; i < total; i++) picked.push(files[Math.min(files.length - 1, Math.floor(i * step))])

// ---------------- 统计工具 ----------------
function emptyDiag() {
  return {
    attempts: 0, attemptWithUsage: 0, attemptNonZero: 0, attemptZeroUsage: 0,
    messages: 0, messagesWithDataUsage: 0, messagesWithoutDataUsage: 0,
    messagesStreamUsageFallback: 0, messagesNoUsageAtAll: 0,
    retryStarted: 0, headerEffortCount: 0,
    firstEffortSeq: null, firstSettleSeq: null,
    settleEvents: 0, settleKeys: 0, adjacentRepeat: 0, nonConsecutiveRepeat: 0,
    zeroAttemptSameStepBeforeMessage: 0,
    headerCreatedAtTruthy: true,
  }
}

function usageTotal(u) {
  if (!u) return 0
  return (u.inputTokens || 0) + (u.outputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0)
}

function lastStreamUsage(stream) {
  if (!Array.isArray(stream)) return undefined
  for (let i = stream.length - 1; i >= 0; i--) {
    const chunk = stream[i]?.chunk
    if (chunk && chunk.type === 'usage' && chunk.usage) return chunk.usage
  }
  return undefined
}

function collectDiag(header, events) {
  const d = emptyDiag()
  if (!header || !header.createdAt) d.headerCreatedAtTruthy = false
  const settleSeq = []
  const settleKeyList = []
  const attemptZeroSteps = new Set()
  for (const ev of events) {
    const data = ev.data || {}
    if (ev.type === 'request/header') {
      const e = data.header?.config?.reasoningEffort
      if (typeof e === 'string' && e) {
        d.headerEffortCount += 1
        if (d.firstEffortSeq == null) d.firstEffortSeq = ev.seq
      }
    } else if (ev.type === 'assistant/message') {
      d.messages += 1
      if (data.usage !== undefined && data.usage !== null) {
        d.messagesWithDataUsage += 1
        settleSeq.push(ev.seq)
        settleKeyList.push(data.turn + ':' + data.step)
      } else {
        d.messagesWithoutDataUsage += 1
        const su = lastStreamUsage(data.stream)
        if (su) { d.messagesStreamUsageFallback += 1; settleSeq.push(ev.seq); settleKeyList.push(data.turn + ':' + data.step) }
        else d.messagesNoUsageAtAll += 1
      }
    } else if (ev.type === 'assistant/attempt') {
      d.attempts += 1
      const u = lastStreamUsage(data.stream)
      if (u) {
        d.attemptWithUsage += 1
        const t = usageTotal(u)
        if (t > 0) d.attemptNonZero += 1
        else {
          d.attemptZeroUsage += 1
          attemptZeroSteps.add(data.turn + ':' + data.step)
        }
        settleSeq.push(ev.seq)
        settleKeyList.push(data.turn + ':' + data.step)
      }
    } else if (ev.type === 'assistant/chunk') {
      const chunk = data.chunk
      if (chunk && chunk.type === 'usage' && chunk.usage) {
        settleSeq.push(ev.seq)
        settleKeyList.push(data.turn + ':' + data.step)
      }
    } else if (ev.type === 'llm/retry-started') {
      d.retryStarted += 1
    }
  }
  d.settleEvents = settleKeyList.length
  const counts = new Map()
  for (const k of settleKeyList) counts.set(k, (counts.get(k) || 0) + 1)
  d.settleKeys = counts.size
  for (let i = 1; i < settleKeyList.length; i++) {
    if (settleKeyList[i] === settleKeyList[i - 1]) d.adjacentRepeat += 1
  }
  for (const [k, c] of counts) if (c > 1) d.nonConsecutiveRepeat += c - 1
  d.nonConsecutiveRepeat = Math.max(0, d.nonConsecutiveRepeat - d.adjacentRepeat)
  if (settleSeq.length && d.firstEffortSeq != null) {
    d.firstSettleSeq = settleSeq[0]
  }
  // 最后一条 assistant/message 的 (turn,step) 是否命中零 usage attempt 的 step
  for (const k of attemptZeroSteps) {
    if (settleKeyList.includes(k)) d.zeroAttemptSameStepBeforeMessage += 1
  }
  return d
}

// ---------------- 对拍 ----------------
function diffMaps(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})])
  const out = []
  for (const k of keys) {
    const av = a?.[k] ?? 0
    const bv = b?.[k] ?? 0
    if (av !== bv) out.push([k, av, bv])
  }
  return out
}

const SCALAR_FIELDS = [
  'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens',
  'messageCount', 'maxSeg', 'createdAt',
]
const MAP_FIELDS = ['days', 'thinking', 'models', 'tools', 'skills']

const oldAgg = new OldAggregator()
const newViews = []
const perSession = []
let decodeFailures = 0
let badLines = 0

for (const file of picked) {
  let session
  try {
    session = loadSession(file)
  } catch (error) {
    decodeFailures += 1
    perSession.push({ file, decodeError: String(error && error.message || error) })
    continue
  }
  badLines += session.badLines
  const header = session.header || { createdAt: 0, id: file }
  const id = header.id || file
  let diag
  try {
    diag = collectDiag(session.header, session.events)
  } catch (error) {
    diag = emptyDiag()
    diag.diagError = String(error && error.message || error)
  }
  try {
    oldAgg.backfillSession(id, header, session.events)
  } catch (error) {
    perSession.push({ file, id, error: 'old: ' + (error && error.message || error) })
    continue
  }
  let view
  try {
    let state = createSessionState(header)
    for (const ev of session.events) state = applySessionEvent(state, ev)
    view = sessionView(state)
  } catch (error) {
    perSession.push({ file, id, error: 'new: ' + (error && error.message || error) })
    continue
  }
  newViews.push(view)
  const oldContribution = oldAgg.sessionContribution(id)
  const fieldDiffs = []
  for (const f of SCALAR_FIELDS) {
    if (oldContribution[f] !== view[f]) fieldDiffs.push([f, oldContribution[f], view[f]])
  }
  if (oldContribution.lastMsgTime !== view.lastMsgTime) fieldDiffs.push(['lastMsgTime', oldContribution.lastMsgTime, view.lastMsgTime])
  if (oldContribution.segStart !== view.segStart) fieldDiffs.push(['segStart', oldContribution.segStart, view.segStart])
  for (const f of MAP_FIELDS) {
    const dm = diffMaps(oldContribution[f], view[f])
    if (dm.length) fieldDiffs.push([f, dm])
  }
  if (fieldDiffs.length) perSession.push({ file, id, diag, diffs: fieldDiffs })
}

const oldGlobal = oldAgg.snapshot()
const progress = { phase: 'ready', done: newViews.length, total: picked.length, fromCache: 0, coldReads: newViews.length, mode: 'fallback' }
const newGlobal = buildGlobalSnapshot(newViews, progress)

// 全局对拍
const GLOBAL_SCALARS = [
  'totalConversations', 'totalMessages', 'totalTokens', 'peakTokens', 'maxDurationSec',
  'currentStreak', 'longestStreak', 'totalToolCalls', 'distinctTools',
  'totalSkillUses', 'distinctSkills', 'earliestDate', 'latestDate', 'maxDurationText',
]
const globalDiffs = []
for (const f of GLOBAL_SCALARS) {
  if (oldGlobal[f] !== newGlobal[f]) globalDiffs.push([f, oldGlobal[f], newGlobal[f]])
}
const dailyDiff = diffMaps(oldGlobal.dailyTokens, newGlobal.dailyTokens)
if (dailyDiff.length) globalDiffs.push(['dailyTokens', dailyDiff])
const thinkingDiff = diffMaps(oldGlobal.thinkingLevels, newGlobal.thinkingLevels)
if (thinkingDiff.length) globalDiffs.push(['thinkingLevels', thinkingDiff])
const modelDiff = diffMaps(oldGlobal.modelBreakdown, newGlobal.modelBreakdown)
if (modelDiff.length) globalDiffs.push(['modelBreakdown', modelDiff])
const topPluginsOld = Object.fromEntries(oldGlobal.topPlugins)
const topPluginsNew = Object.fromEntries(newGlobal.topPlugins)
const tpDiff = diffMaps(topPluginsOld, topPluginsNew)
if (tpDiff.length) globalDiffs.push(['topPlugins', tpDiff, oldGlobal.topPlugins, newGlobal.topPlugins])
const topSkillsOld = Object.fromEntries(oldGlobal.topSkills)
const topSkillsNew = Object.fromEntries(newGlobal.topSkills)
const tsDiff = diffMaps(topSkillsOld, topSkillsNew)
if (tsDiff.length) globalDiffs.push(['topSkills', tsDiff, oldGlobal.topSkills, newGlobal.topSkills])

// 归因分类
function classify(diag, field) {
  if (!diag) return 'unknown'
  if (field === 'thinking' || field === 'models') {
    if (diag.zeroAttemptSameStepBeforeMessage > 0) return 'attempt-zero-usage-last-slot'
    if (diag.headerEffortCount > 0 && diag.attempts === 0) return 'header-effort-fallback'
    if (diag.zeroAttemptSameStepBeforeMessage === 0 && diag.attempts > 0) return 'attempt-related'
    return 'unknown'
  }
  if (['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens', 'days'].includes(field)) {
    if (diag.attemptNonZero > 0) return 'attempt-embedded-usage'
    if (diag.messagesStreamUsageFallback > 0) return 'message-stream-usage-fallback'
    if (diag.nonConsecutiveRepeat > 0) return 'non-consecutive-duplicate-step'
    if (diag.retryStarted > 0) return 'retry-reset-related'
    if (diag.attemptWithUsage > 0) return 'attempt-related'
    return 'unknown'
  }
  if (field === 'createdAt' || field === 'lastMsgTime' || field === 'segStart' || field === 'maxSeg' || field === 'messageCount') {
    if (!diag.headerCreatedAtTruthy) return 'header-createdAt-falsy'
    return 'message-timeline'
  }
  return 'unknown'
}

const classCounts = {}
const fieldCounts = {}
const detailLines = []
for (const s of perSession) {
  if (s.decodeError || s.error) continue
  for (const d of s.diffs) {
    const klass = classify(s.diag, d[0])
    classCounts[klass] = (classCounts[klass] || 0) + 1
    fieldCounts[d[0]] = (fieldCounts[d[0]] || 0) + 1
    if (detailLines.length < DETAIL) {
      let oldV = d[1]
      let newV = d[2]
      if (Array.isArray(oldV) && Array.isArray(oldV[0])) {
        oldV = JSON.stringify(oldV.slice(0, 8))
        newV = '(同一字段的 new 差异项)'
      }
      detailLines.push({
        session: s.id, field: d[0], class: klass,
        old: typeof oldV === 'object' ? JSON.stringify(oldV) : oldV,
        new: typeof newV === 'object' ? JSON.stringify(newV) : newV,
        diag: {
          attempts: s.diag.attempts, attemptNonZero: s.diag.attemptNonZero,
          attemptZero: s.diag.attemptZeroUsage, retryStarted: s.diag.retryStarted,
          msgNoDataUsage: s.diag.messagesWithoutDataUsage,
          msgStreamFallback: s.diag.messagesStreamUsageFallback,
          headerEffort: s.diag.headerEffortCount, firstEffortSeq: s.diag.firstEffortSeq,
          firstSettleSeq: s.diag.firstSettleSeq,
          nonConsecutiveRepeat: s.diag.nonConsecutiveRepeat,
        },
      })
    }
  }
}

const summary = {
  files: files.length,
  sampled: picked.length,
  compared: newViews.length,
  decodeFailures,
  badLines,
  sessionsWithDiffs: perSession.filter((s) => s.diffs && s.diffs.length).length,
  diffFieldCount: Object.values(fieldCounts).reduce((a, b) => a + b, 0),
  fieldCounts,
  classCounts,
  globalDiffs,
  oldGlobalSummary: {
    totalConversations: oldGlobal.totalConversations, totalMessages: oldGlobal.totalMessages,
    totalTokens: oldGlobal.totalTokens, peakTokens: oldGlobal.peakTokens,
    maxDurationSec: oldGlobal.maxDurationSec, currentStreak: oldGlobal.currentStreak,
    longestStreak: oldGlobal.longestStreak, totalToolCalls: oldGlobal.totalToolCalls,
    distinctTools: oldGlobal.distinctTools, totalSkillUses: oldGlobal.totalSkillUses,
    distinctSkills: oldGlobal.distinctSkills, earliestDate: oldGlobal.earliestDate,
    latestDate: oldGlobal.latestDate, thinkingLevels: oldGlobal.thinkingLevels,
    days: Object.keys(oldGlobal.dailyTokens).length,
  },
  newGlobalSummary: {
    totalConversations: newGlobal.totalConversations, totalMessages: newGlobal.totalMessages,
    totalTokens: newGlobal.totalTokens, peakTokens: newGlobal.peakTokens,
    maxDurationSec: newGlobal.maxDurationSec, currentStreak: newGlobal.currentStreak,
    longestStreak: newGlobal.longestStreak, totalToolCalls: newGlobal.totalToolCalls,
    distinctTools: newGlobal.distinctTools, totalSkillUses: newGlobal.totalSkillUses,
    distinctSkills: newGlobal.distinctSkills, earliestDate: newGlobal.earliestDate,
    latestDate: newGlobal.latestDate, thinkingLevels: newGlobal.thinkingLevels,
    days: Object.keys(newGlobal.dailyTokens).length,
  },
  details: detailLines,
}

if (AS_JSON) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  console.log('== 对拍范围 ==')
  console.log('日志文件总数', files.length, '本次抽样', picked.length, '成功对拍', newViews.length, '解码失败', decodeFailures, '坏行', badLines)
  console.log('\n== 全局 ==')
  console.log('old:', JSON.stringify(summary.oldGlobalSummary))
  console.log('new:', JSON.stringify(summary.newGlobalSummary))
  console.log('全局差异:', globalDiffs.length ? JSON.stringify(globalDiffs, null, 1) : '无')
  console.log('\n== 逐会话 ==')
  console.log('有差异会话数', summary.sessionsWithDiffs, '/', newViews.length)
  console.log('差异字段计数', JSON.stringify(fieldCounts))
  console.log('差异分类', JSON.stringify(classCounts))
  console.log('\n== 差异明细（前 ' + DETAIL + ' 条）==')
  for (const line of detailLines) console.log(JSON.stringify(line))
}
