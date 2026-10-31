/** 历史基线的 wire 契约 + 构建产物解析一致性 + 真实 DSH home 下的端到端合并。 */
import { readFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { listSessionFiles, loadSession } from './sessions.mjs'
import { parseHistoryBaseline as parseSrc } from '../../src/history.ts'
import { parseHistoryBaseline as parseBuilt } from '../../lib/types/history.js'
import { createSessionState, applySessionEvent, sessionView } from '../../src/aggregate.ts'
import { TYPERT } from '../../lib/typert.host.js'
import { homedir } from 'node:os'

const results = []
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : '')) }

/* A) 解析器与构建产物 */
const baselineRaw = JSON.parse(readFileSync('scripts/history/baseline-2026-08-26_2026-10-10.json', 'utf8'))
const srcParsed = parseSrc(baselineRaw)
const builtParsed = parseBuilt(baselineRaw)
check('A1. src/history.ts 与 lib/types/history.js 解析结果一致', JSON.stringify(srcParsed) === JSON.stringify(builtParsed))
check('A2. 构建产物解析出总量 421.35 亿 / 9-23 27.89 亿', builtParsed.totalTokens === 42135000000 && builtParsed.dailyTokens['2026-09-23'] === 2789000000)

/* 样本会话 */
const files = listSessionFiles()
const samples = [files[files.length - 1], files[files.length - 2]].map((f) => loadSession(f))
const realTotal = samples.reduce((acc, s) => {
  let st = createSessionState(s.header)
  for (const ev of s.events) st = applySessionEvent(st, ev)
  return acc + sessionView(st).totalTokens
}, 0)

const { TokenUsageService } = await import('../../lib/types/index.js')
const { Service } = await import('@deepseek-ai/cordis')

function makeSp() {
  return {
    async list() { return samples.map((s) => ({ header: s.header, revision: 'rev-' + s.header.id })) },
    async open(id) {
      const s = samples.find((x) => x.header.id === id)
      return { header: s.header, inheritedEventCount: 0, async read() { return { events: s.events } }, async close() {} }
    },
  }
}
function makeCtx(sp) {
  return {
    sessionPersistence: sp,
    on() { return () => {} },
    effect(fn) { fn(); return () => {} },
    inject(services, cb) { cb({ get: () => undefined }); return { dispose() {} } },
    get() { return undefined },
  }
}
async function boot() {
  const service = new TokenUsageService(makeCtx(makeSp()))
  await service[Service.init]()
  const start = Date.now()
  while (service.progress.phase !== 'ready' && Date.now() - start < 30000) await new Promise((r) => setTimeout(r, 10))
  return service
}

/* B) 无基线（临时 DSH_HOME）：history=null */
const tmpHome = join(process.cwd(), 'scripts/verify/out', 'dsh-home-wire')
rmSync(tmpHome, { recursive: true, force: true })
mkdirSync(tmpHome, { recursive: true })
process.env.DSH_HOME = tmpHome
const serviceNoHistory = await boot()
const snapNull = serviceNoHistory.getStats()
check('B1. 临时 DSH_HOME（无基线）时 getStats history=null', 'history' in snapNull && snapNull.history === null, snapNull.history)
check('B2. 无基线下 totalTokens == 视图直算', snapNull.totalTokens === realTotal, [snapNull.totalTokens, realTotal])

const inv = TYPERT.invocations.find((i) => i.id === 'dsh-token-usage#tokenUsage/getStats')
const schema = inv.result.create()
let parsedNull = null
try { parsedNull = schema.parse(JSON.parse(JSON.stringify(snapNull))) } catch (e) { console.log('parse error', e.message) }
check('B3. typert schema 接受无基线快照且 history=null', parsedNull !== null && parsedNull.history === null)

/* C) 真实 DSH home（基线已安装）：history 自动加载并合并 */
delete process.env.DSH_HOME
const realHistoryPath = join(homedir(), '.dsh', 'storages', 'dsh-token-usage', 'history-baseline.v1.json')
let installed = false
try { installed = JSON.parse(readFileSync(realHistoryPath, 'utf8')).version === 1 } catch {}
if (!installed) {
  check('C0. 真实 DSH home 已安装基线文件', false, realHistoryPath)
} else {
  check('C0. 真实 DSH home 已安装基线文件', true, realHistoryPath)
  const serviceHistory = await boot()
  const snapHistory = serviceHistory.getStats()
  const h = snapHistory.history
  check('C1. service 自动加载基线（history 非空）', h !== null && h.totalTokens === 42135000000 && h.estimatedDaily === true && h.importedAt > 0, h)
  check('C2. 合并后 totalTokens = 视图直算 + 421.35 亿', snapHistory.totalTokens === realTotal + 42135000000, [snapHistory.totalTokens, realTotal + 42135000000])
  check('C3. 合并后 peakTokens = 23.09 亿', snapHistory.peakTokens === 2309000000, snapHistory.peakTokens)
  // 本场景只加载 2 个样本会话，streak 需按"样本会话日期 ∪ 基线 activeDates"计算
  const { streakDays } = await import('../../src/aggregate.ts')
  const sampleDates = samples.map((s) => new Date(s.header.createdAt).toISOString().slice(0, 10))
  const expectedStreak = streakDays([...new Set([...sampleDates, ...(builtParsed.activeDates || [])])])
  check('C4. 合并后 streak 与样本日期 ∪ 基线 activeDates 一致', snapHistory.currentStreak === expectedStreak[0] && snapHistory.longestStreak === expectedStreak[1], { got: [snapHistory.currentStreak, snapHistory.longestStreak], expected: expectedStreak })
  check('C5. 合并后 earliestDate = 2026-08-26', snapHistory.earliestDate === '2026-08-26', snapHistory.earliestDate)
  check('C6. 合并后 dailyTokens 含基线 9-23=27.89 亿', snapHistory.dailyTokens['2026-09-23'] === 2789000000, snapHistory.dailyTokens['2026-09-23'])
  let parsedHistory = null
  try { parsedHistory = schema.parse(JSON.parse(JSON.stringify(snapHistory))) } catch (e) { console.log('history snap parse error', e.message) }
  check('C7. typert schema 接受带历史的真实快照', parsedHistory !== null && parsedHistory.history && parsedHistory.history.totalTokens === 42135000000)
  check('C8. schema 拒绝缺 history 的快照', (() => { const m = { ...snapHistory }; delete m.history; try { schema.parse(JSON.parse(JSON.stringify(m))); return false } catch { return true } })())
  check('C9. schema 拒绝缺 importedAt 的 history 对象', (() => { const b = { ...snapHistory, history: { label: 'x', range: ['2026-08-26', '2026-10-10'], totalTokens: 1, estimatedDaily: true } }; try { schema.parse(JSON.parse(JSON.stringify(b))); return false } catch { return true } })())
  console.log('\n真实 home 合并快照:', JSON.stringify({ totalConversations: snapHistory.totalConversations, totalMessages: snapHistory.totalMessages, totalTokens: snapHistory.totalTokens, peakTokens: snapHistory.peakTokens, maxDurationSec: snapHistory.maxDurationSec, streaks: [snapHistory.currentStreak, snapHistory.longestStreak], range: [snapHistory.earliestDate, snapHistory.latestDate], history: h }))
}

const failed = results.filter((r) => !r.ok)
console.log('\n通过', results.length - failed.length, '/', results.length)
process.exitCode = failed.length ? 1 : 0
