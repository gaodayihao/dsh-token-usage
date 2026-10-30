/** 全量 909 会话生成一次权威快照（新实现），并剖析唯一差异会话。 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { listSessionFiles, loadSession } from './sessions.mjs'
import { createSessionState, applySessionEvent, sessionView, buildGlobalSnapshot } from '../../src/aggregate.ts'

const files = listSessionFiles()
const views = []
let decoded = 0
const diffSessionId = 'session-19bbdacf-7861-4641-85b4-54f8005f83ed'
let diffDetail = null

for (const file of files) {
  const s = loadSession(file)
  decoded += 1
  let state = createSessionState(s.header)
  for (const ev of s.events) state = applySessionEvent(state, ev)
  const view = sessionView(state)
  views.push(view)

  if (s.header && s.header.id === diffSessionId) {
    // 剖析：首个带 reasoningEffort 的 request/header 之前有几次结算、对应天数
    let firstEffortSeq = null
    let settleSeq = []
    const settleTimes = []
    const effortChanges = []
    for (const ev of s.events) {
      const data = ev.data || {}
      if (ev.type === 'request/header') {
        const e = data.header?.config?.reasoningEffort
        effortChanges.push({ seq: ev.seq, effort: e ?? null, provider: data.header?.config?.provider, reason: data.reason })
        if (typeof e === 'string' && e && firstEffortSeq == null) firstEffortSeq = ev.seq
      } else if (ev.type === 'assistant/message' && data.usage !== undefined && data.usage !== null) {
        settleSeq.push(ev.seq)
        settleTimes.push({ seq: ev.seq, time: ev.time, day: new Date(ev.time).toISOString().slice(0, 10), reasoningTokens: data.usage.reasoningTokens ?? null })
      }
    }
    const before = settleTimes.filter((x) => x.seq < firstEffortSeq)
    diffDetail = {
      sessionId: diffSessionId,
      createdIso: new Date(s.header.createdAt).toISOString(),
      settlements: settleTimes.length,
      firstEffortSeq,
      settlementsBeforeFirstEffort: before.length,
      daysBefore: [...new Set(before.map((x) => x.day))],
      reasoningTokensBefore: [...new Set(before.map((x) => x.reasoningTokens))],
      effortChanges,
      // 注意：以下两项是“修复前”旧/新口径的预期分类，仅作差异成因记录。
      preFixOldHigh: settleTimes.length,
      preFixNewHigh: settleTimes.length - before.length,
      preFixNewOff: before.length,
    }
  }
}

const snapshot = buildGlobalSnapshot(views, { phase: 'ready', done: views.length, total: views.length, fromCache: 0, coldReads: views.length, mode: 'fallback' })
mkdirSync('scripts/verify/out', { recursive: true })
writeFileSync('scripts/verify/out/snapshot-full.json', JSON.stringify(snapshot, null, 2))
writeFileSync('scripts/verify/out/diff-session.json', JSON.stringify(diffDetail, null, 2))
console.log('decoded', decoded, 'views', views.length)
console.log('snapshot:', JSON.stringify({
  totalConversations: snapshot.totalConversations,
  totalMessages: snapshot.totalMessages,
  totalTokens: snapshot.totalTokens,
  peakTokens: snapshot.peakTokens,
  maxDurationSec: snapshot.maxDurationSec,
  maxDurationText: snapshot.maxDurationText,
  currentStreak: snapshot.currentStreak,
  longestStreak: snapshot.longestStreak,
  totalToolCalls: snapshot.totalToolCalls,
  distinctTools: snapshot.distinctTools,
  totalSkillUses: snapshot.totalSkillUses,
  distinctSkills: snapshot.distinctSkills,
  earliestDate: snapshot.earliestDate,
  latestDate: snapshot.latestDate,
  thinkingLevels: snapshot.thinkingLevels,
  modelBreakdown: snapshot.modelBreakdown,
  topPlugins: snapshot.topPlugins,
  topSkills: snapshot.topSkills,
  days: Object.keys(snapshot.dailyTokens).length,
  dailySum: Object.values(snapshot.dailyTokens).reduce((a, b) => a + b, 0),
}, null, 1))
console.log('diffDetail:', JSON.stringify(diffDetail, null, 1))
