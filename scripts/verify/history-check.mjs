/**
 * 历史基线（history baseline）合并验证 + 无基线回归。
 * 运行：node --max-old-space-size=6144 scripts/verify/history-check.mjs
 */
import { readFileSync } from 'node:fs'
import { listSessionFiles, loadSession } from './sessions.mjs'
import { createSessionState, applySessionEvent, sessionView, buildGlobalSnapshot, streakDays, fmtDuration } from '../../src/aggregate.ts'
import { parseHistoryBaseline } from '../../src/history.ts'

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail })
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''))
}
function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  if (typeof a === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b)
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]))
  }
  return false
}
function withoutUpdated(snap) { const c = { ...snap }; delete c.updatedAt; return c }

/* ── 1) 基线文件解析 ─────────────────────────────────────────────────────── */
const baselinePath = 'scripts/history/baseline-2026-08-26_2026-10-10.json'
const raw = JSON.parse(readFileSync(baselinePath, 'utf8'))
const baseline = parseHistoryBaseline(raw)
check('1a. parseHistoryBaseline 解析成功', Boolean(baseline))
if (baseline) {
  const dailySum = Object.values(baseline.dailyTokens).reduce((a, b) => a + b, 0)
  check('1b. 累计 token = 421.35 亿', baseline.totalTokens === 42135000000, baseline.totalTokens)
  check('1c. daily 合计 = 421.35 亿', dailySum === 42135000000, dailySum)
  check('1d. 9-23 = 27.89 亿', baseline.dailyTokens['2026-09-23'] === 2789000000, baseline.dailyTokens['2026-09-23'])
  check('1e. range / label / estimatedDaily', deepEqual(baseline.range, ['2026-08-26', '2026-10-10']) && baseline.dailyEstimated === true, [baseline.range, baseline.dailyEstimated])
  check('1f. activeDates / 峰值 / 时长 / 会话 / 消息 / 工具', baseline.activeDates?.length === 41 && baseline.peakTokens === 2309000000 && baseline.maxDurationSec === 35820 && baseline.totalConversations === 1137 && baseline.totalMessages === 153724 && baseline.totalToolCalls === 194617, {
    activeDates: baseline.activeDates?.length, peakTokens: baseline.peakTokens, maxDurationSec: baseline.maxDurationSec,
    totalConversations: baseline.totalConversations, totalMessages: baseline.totalMessages, totalToolCalls: baseline.totalToolCalls,
  })
  // 非法输入 fail-soft
  check('1g. 非法输入返回 undefined', parseHistoryBaseline(null) === undefined && parseHistoryBaseline({ version: 2 }) === undefined && parseHistoryBaseline({ version: 1, range: ['x', 'y'], dailyTokens: {} }) === undefined)
}

/* ── 2) 折叠当前全部会话（等价于 projcache 视图集合） ────────────────────── */
const files = listSessionFiles()
const views = []
for (const file of files) {
  const s = loadSession(file)
  let state = createSessionState(s.header)
  for (const ev of s.events) state = applySessionEvent(state, ev)
  views.push(sessionView(state))
}
const progress = { phase: 'ready', done: views.length, total: views.length, fromCache: 0, coldReads: views.length, mode: 'fallback' }
console.log('会话数', views.length)

const realTotal = views.reduce((a, v) => a + v.totalTokens, 0)
const realMessages = views.reduce((a, v) => a + v.messageCount, 0)
const realPeak = views.reduce((a, v) => Math.max(a, v.totalTokens), 0)
const realMaxSeg = views.reduce((a, v) => Math.max(a, v.maxSeg, v.lastMsgTime != null && v.segStart != null ? (v.lastMsgTime - v.segStart) / 1000 : 0), 0)
const realTools = {}
const realSkills = {}
const realThinking = { high: 0, medium: 0, low: 0, off: 0 }
const realModels = {}
const realDays = {}
const realDates = []
for (const v of views) {
  for (const [k, n] of Object.entries(v.tools)) realTools[k] = (realTools[k] || 0) + n
  for (const [k, n] of Object.entries(v.skills)) realSkills[k] = (realSkills[k] || 0) + n
  for (const k of ['high', 'medium', 'low', 'off']) realThinking[k] += v.thinking[k]
  for (const [k, n] of Object.entries(v.models)) realModels[k] = (realModels[k] || 0) + n
  for (const [k, n] of Object.entries(v.days)) realDays[k] = (realDays[k] || 0) + n
  if (v.createdAt) realDates.push(new Date(v.createdAt).toISOString().slice(0, 10))
}
const realToolCalls = Object.values(realTools).reduce((a, b) => a + b, 0)
const realSkillUses = Object.values(realSkills).reduce((a, b) => a + b, 0)
const realDistinctTools = Object.keys(realTools).length
const realDistinctSkills = Object.keys(realSkills).length
const realDailySum = Object.values(realDays).reduce((a, b) => a + b, 0)
const realLatestDate = [...realDates].sort().at(-1) || ''

/* ── 3) 无基线回归：undefined / null 与旧口径一致，history 为 null ──────── */
const snapNoArg = buildGlobalSnapshot(views, progress)
const snapNull = buildGlobalSnapshot(views, progress, null)
check('3a. 不传 baseline 时 history 字段为 null', snapNoArg.history === null, snapNoArg.history)
check('3b. history=undefined 与 history=null 结果一致', deepEqual(withoutUpdated(snapNoArg), withoutUpdated(snapNull)))
check('3c. 无基线时总量/消息/峰值/时长与视图直算一致', snapNoArg.totalTokens === realTotal && snapNoArg.totalMessages === realMessages && snapNoArg.peakTokens === realPeak && snapNoArg.maxDurationSec === realMaxSeg, [snapNoArg.totalTokens, realTotal])
check('3d. 无基线时 daily 合计 == totalTokens', Object.values(snapNoArg.dailyTokens).reduce((a, b) => a + b, 0) === snapNoArg.totalTokens)

/* ── 4) 合并历史基线 ─────────────────────────────────────────────────────── */
const merged = buildGlobalSnapshot(views, progress, baseline)
const h = merged.history
check('4a. history 摘要字段正确', h && h.label === baseline.label && deepEqual(h.range, baseline.range) && h.totalTokens === 42135000000 && h.estimatedDaily === true && h.importedAt === 0, h)
check('4b. 累计 token = 真实 + 421.35 亿', merged.totalTokens === realTotal + 42135000000, [merged.totalTokens, realTotal + 42135000000])
check('4c. 峰值 = max(真实, 23.09 亿)', merged.peakTokens === Math.max(realPeak, 2309000000), [merged.peakTokens, realPeak])
check('4d. 最长聊天段 = max(真实, 35820s)', merged.maxDurationSec === Math.max(realMaxSeg, 35820) && merged.maxDurationText === fmtDuration(Math.max(realMaxSeg, 35820)), [merged.maxDurationSec, merged.maxDurationText])
check('4e. 会话数 = 真实 + 1137', merged.totalConversations === views.length + 1137, [merged.totalConversations, views.length + 1137])
check('4f. 消息数 = 真实 + 153724', merged.totalMessages === realMessages + 153724, [merged.totalMessages, realMessages + 153724])
check('4g. 工具总数 = 真实 + 194617（Top 明细不重复计）', merged.totalToolCalls === realToolCalls + 194617, [merged.totalToolCalls, realToolCalls + 194617])
check('4h. skill 总数 = 真实 + 0', merged.totalSkillUses === realSkillUses + 0, [merged.totalSkillUses, realSkillUses])
check('4i. distinctTools = max(真实, 228)；distinctSkills 不变', merged.distinctTools === Math.max(realDistinctTools, 228) && merged.distinctSkills === Math.max(realDistinctSkills, 0), [merged.distinctTools, merged.distinctSkills])
check('4j. thinking / 模型沿用真实分布（基线无该维度）', deepEqual(merged.thinkingLevels, realThinking) && deepEqual(merged.modelBreakdown, realModels), [merged.thinkingLevels, merged.modelBreakdown])
check('4k. 日期范围 2026-08-26 ~ max(真实, 2026-10-10)', merged.earliestDate === '2026-08-26' && merged.latestDate === [realLatestDate, '2026-10-10'].sort().at(-1), [merged.earliestDate, merged.latestDate, realLatestDate])
check('4l. daily 合计 == totalTokens', Object.values(merged.dailyTokens).reduce((a, b) => a + b, 0) === merged.totalTokens)
check('4m. 9-23 daily = 27.89 亿（真实数据该日无会话）', merged.dailyTokens['2026-09-23'] === 2789000000 + (realDays['2026-09-23'] || 0), [merged.dailyTokens['2026-09-23'], realDays['2026-09-23'] || 0])
const mergedPwsh = merged.dailyTokens ? null : null
const expectedTop = Object.entries({ ...realTools, ...{} })
// Top 插件：合并基线 Top 后重排
const mergedToolMap = { ...realTools }
for (const [name, count] of raw.topPlugins) mergedToolMap[name] = (mergedToolMap[name] || 0) + count
const expectedTopPlugins = Object.entries(mergedToolMap).filter(([n]) => !['bash','read','read_image','write','edit','glob','grep','todo_write','ask_user_question','subagent','subagent_fork','interrupt_agent','list_agents','send_message','job_kill','job_list','job_output','workflow','ralph','create_goal','get_goal','update_goal','exit_plan_mode','web_search','session_search','session_event_search','session_event_read','session_event_trace','session_trace','schedule_create','schedule_list','schedule_delete','skill','cordis_define','cordis_run','cordis_stop','cordis_undefine','cordis_inspect_list','cordis_inspect_query','cordis_inspect_self','mcp__reference_memory__read_graph','mcp__reference_memory__search_nodes','mcp__reference_memory__open_nodes','mcp__reference_memory__create_entities','mcp__reference_memory__add_observations','mcp__reference_memory__create_relations','mcp__reference_memory__delete_entities','mcp__reference_memory__delete_observations','mcp__reference_memory__delete_relations'].includes(n))
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5)
check('4n. topPlugins 合并后重排（pwsh 含历史 49556）', deepEqual(merged.topPlugins, expectedTopPlugins) && merged.topPlugins.some(([n, c]) => n === 'pwsh' && c === (realTools['pwsh'] || 0) + 49556), { got: merged.topPlugins, expected: expectedTopPlugins })

// 连续天数：activeDates = 真实会话日期 ∪ 基线 activeDates
const unionDates = [...new Set([...realDates, ...(baseline.activeDates || [])])]
const expectedStreak = streakDays(unionDates)
const directStreak = streakDays(Object.keys(merged.dailyTokens))
check('4o. streak 与合并后的活跃日期一致', deepEqual([merged.currentStreak, merged.longestStreak], expectedStreak), { got: [merged.currentStreak, merged.longestStreak], expected: expectedStreak, directFromDaily: directStreak, unionDates: unionDates.length })
check('4p. 预期附近：当前/最长 ≈ 61', Math.abs(merged.currentStreak - 61) <= 2 && Math.abs(merged.longestStreak - 61) <= 2, [merged.currentStreak, merged.longestStreak])

/* ── 汇总 ────────────────────────────────────────────────────────────────── */
console.log('\n== 合并结果 ==')
console.log(JSON.stringify({
  real: { sessions: views.length, messages: realMessages, totalTokens: realTotal, peakTokens: realPeak, maxDurationSec: realMaxSeg, distinctTools: realDistinctTools, toolCalls: realToolCalls, latestDate: realLatestDate, dailySum: realDailySum },
  merged: {
    totalConversations: merged.totalConversations, totalMessages: merged.totalMessages, totalTokens: merged.totalTokens,
    peakTokens: merged.peakTokens, maxDurationSec: merged.maxDurationSec, maxDurationText: merged.maxDurationText,
    currentStreak: merged.currentStreak, longestStreak: merged.longestStreak,
    totalToolCalls: merged.totalToolCalls, distinctTools: merged.distinctTools,
    totalSkillUses: merged.totalSkillUses, distinctSkills: merged.distinctSkills,
    earliestDate: merged.earliestDate, latestDate: merged.latestDate,
    thinkingLevels: merged.thinkingLevels, modelBreakdown: merged.modelBreakdown,
    history: merged.history, days: Object.keys(merged.dailyTokens).length,
    dailySum: Object.values(merged.dailyTokens).reduce((a, b) => a + b, 0),
    topPlugins: merged.topPlugins,
  },
}, null, 1))
const failed = results.filter((r) => !r.ok)
console.log('\n== 历史基线验证汇总 ==')
console.log('通过', results.length - failed.length, '/', results.length)
for (const f of failed) console.log(' -', f.name, JSON.stringify(f.detail))
process.exitCode = failed.length ? 1 : 0
