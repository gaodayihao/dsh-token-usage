/**
 * 工具口径对拍：把全部会话日志按当前实现折叠一遍，输出"真实工具调用"口径的
 * 排行榜（顶层 tool/call + run_code 内联 tool/ptc-dispatch-start），并与
 * 历史基线（~/.dsh/storages/dsh-token-usage/history-baseline.v1.json）合并。
 *
 * fork 子会话的继承前缀：verify 脚本没有持久化句柄，用"父会话日志前缀匹配"
 * 近似 inheritedEventCount（与生产一致：折叠时跳过 seq < inherited 的事件），
 * 并单独统计被跳过的重复事件数。
 *
 * 用法：
 *   node scripts/verify/tools.mjs                # 全量
 *   node scripts/verify/tools.mjs --limit 100    # 均匀抽样
 *   node scripts/verify/tools.mjs --json
 *   node scripts/verify/tools.mjs --root <dir>   # 指定会话目录
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { listSessionFiles, loadSession } from './sessions.mjs'
import { CORE_TOOLS, applySessionEvent, buildGlobalSnapshot, createSessionState, sessionView } from '../../src/aggregate.ts'
import { parseHistoryBaseline } from '../../src/history.ts'

const argv = process.argv.slice(2)
function arg(name, fallback) {
  const i = argv.indexOf('--' + name)
  if (i < 0) return fallback
  const v = argv[i + 1]
  if (v === undefined || v.startsWith('--')) return true
  return v
}
const LIMIT = Number(arg('limit', 0))
const AS_JSON = arg('json', false) === true
const ROOT = String(arg('root', 'C:/Users/Ellis/.dsh/sessions'))
const HISTORY = String(arg('history', join(homedir(), '.dsh', 'storages', 'dsh-token-usage', 'history-baseline.v1.json')))

const files = listSessionFiles(ROOT)
const total = LIMIT > 0 ? Math.min(LIMIT, files.length) : files.length
const step = LIMIT > 0 && total < files.length ? files.length / total : 1
const picked = []
for (let i = 0; i < total; i++) picked.push(files[Math.min(files.length - 1, Math.floor(i * step))])

/** 事件类型 -> 小整数（前缀比较只需要类型等价）。 */
const typeIds = new Map()
function typeId(name) {
  let id = typeIds.get(name)
  if (id === undefined) { id = typeIds.size; typeIds.set(name, id) }
  return id
}

// ── Pass 1：收集 header + 事件签名（丢 payload，控制内存） ─────────────────
const sessions = []
for (const file of picked) {
  let decoded
  try { decoded = loadSession(file) } catch { continue }
  const header = decoded.header || { createdAt: 0, id: file }
  const seq = []
  const kind = []
  for (const ev of decoded.events) {
    seq.push(typeof ev.seq === 'number' ? ev.seq : -1)
    kind.push(typeId(String(ev.type)))
  }
  sessions.push({ file, id: header.id || file, header, parent: header.parentSession, seq, kind })
}
const byId = new Map(sessions.map((s) => [s.id, s]))

// ── Pass 2：前缀匹配求 inheritedEventCount ─────────────────────────────────
const TYPE_TOOL_CALL = typeId('tool/call')
const TYPE_PTC_START = typeId('tool/ptc-dispatch-start')
let forkSessions = 0
let inheritedEvents = 0
let skippedToolCalls = 0
let skippedPtcStarts = 0
for (const s of sessions) {
  const parentId = typeof s.parent === 'string' ? s.parent : (s.parent && s.parent.id)
  if (!parentId) continue
  const parent = byId.get(parentId)
  if (!parent) continue
  let i = 0
  const n = Math.min(s.seq.length, parent.seq.length)
  while (i < n && s.seq[i] === parent.seq[i] && s.kind[i] === parent.kind[i]) i++
  if (i === 0) continue
  s.inherited = i
  forkSessions += 1
  inheritedEvents += i
  for (let k = 0; k < i; k++) {
    if (s.kind[k] === TYPE_TOOL_CALL) skippedToolCalls += 1
    else if (s.kind[k] === TYPE_PTC_START) skippedPtcStarts += 1
  }
}

// ── Pass 3：按生产口径折叠 ─────────────────────────────────────────────────
const views = []
let decodeFailures = 0
let badLines = 0
for (const s of sessions) {
  let decoded
  try { decoded = loadSession(s.file) } catch { decodeFailures += 1; continue }
  badLines += decoded.badLines || 0
  const inherited = s.inherited || 0
  let state = createSessionState(decoded.header || s.header, inherited)
  for (const ev of decoded.events) state = applySessionEvent(state, ev)
  views.push(sessionView(state))
}

let history = null
try {
  if (existsSync(HISTORY)) history = parseHistoryBaseline(JSON.parse(readFileSync(HISTORY, 'utf8'))) || null
} catch { history = null }

const progress = { phase: 'ready', done: views.length, total: views.length, fromCache: 0, coldReads: views.length, mode: 'fallback' }
const snap = buildGlobalSnapshot(views, progress, history)

const summary = {
  files: files.length,
  folded: views.length,
  decodeFailures,
  badLines,
  forkSessions,
  inheritedEvents,
  skippedToolCalls,
  skippedPtcStarts,
  history: history ? { label: history.label, totalToolCalls: history.totalToolCalls ?? 0 } : null,
  totalTokens: snap.totalTokens,
  totalToolCalls: snap.totalToolCalls,
  inlineToolCalls: snap.inlineToolCalls,
  runCodeCalls: snap.runCodeCalls,
  toolErrors: snap.toolErrors,
  distinctTools: snap.distinctTools,
  totalSkillUses: snap.totalSkillUses,
  distinctSkills: snap.distinctSkills,
  topPlugins: snap.topPlugins,
  topSkills: snap.topSkills,
  coreToolNames: [...CORE_TOOLS].length,
}

if (AS_JSON) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  console.log('== 对拍范围 ==')
  console.log('日志文件', files.length, '本次折叠', views.length, '解码失败', decodeFailures, '坏行', badLines)
  console.log('fork 会话', forkSessions, '跳过继承事件', inheritedEvents, 'tool/call ' + skippedToolCalls, 'ptc-start ' + skippedPtcStarts)
  console.log('历史基线', history ? history.label : '（无）')
  console.log('\n== 汇总 ==')
  console.log('累计 Token', snap.totalTokens)
  console.log('工具调用总数（真实口径）', snap.totalToolCalls)
  console.log('  其中 run_code 内联', snap.inlineToolCalls, '/ run_code 批次', snap.runCodeCalls)
  console.log('内联失败次数', snap.toolErrors)
  console.log('已探索工具', snap.distinctTools, '种')
  console.log('Skill', snap.totalSkillUses, '次 /', snap.distinctSkills, '种')
  console.log('\n== 最常用的插件 Top5 ==')
  for (const [name, cnt] of snap.topPlugins) console.log('  ' + String(name).padEnd(34), cnt)
  console.log('\n== 最常用的 Skill Top5 ==')
  for (const [name, cnt] of snap.topSkills) console.log('  ' + String(name).padEnd(34), cnt)
}
