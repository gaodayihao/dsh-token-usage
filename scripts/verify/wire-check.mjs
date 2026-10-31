/** 历史基线的 wire 契约 + 构建产物解析一致性（真实快照经 service getStats 获取）。 */
import { readFileSync } from 'node:fs'
import { listSessionFiles, loadSession } from '../sessions.mjs'
import { parseHistoryBaseline as parseSrc } from '../../src/history.ts'
import { parseHistoryBaseline as parseBuilt } from '../../lib/types/history.js'
import { TYPERT } from '../../lib/typert.host.js'

const results = []
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : '')) }

const baselineRaw = JSON.parse(readFileSync('scripts/history/baseline-2026-08-26_2026-10-10.json', 'utf8'))
const srcParsed = parseSrc(baselineRaw)
const builtParsed = parseBuilt(baselineRaw)
check('A1. src/history.ts 与 lib/types/history.js 解析结果一致', JSON.stringify(srcParsed) === JSON.stringify(builtParsed))
check('A2. 构建产物解析出总量 421.35 亿 / 9-23 27.89 亿', builtParsed.totalTokens === 42135000000 && builtParsed.dailyTokens['2026-09-23'] === 2789000000)

// service getStats 得到真实快照
const files = listSessionFiles().slice(0, 2)
const samples = files.map((f) => loadSession(f))
const sp = {
  async list() { return samples.map((s) => ({ header: s.header, revision: 'rev-' + s.header.id })) },
  async open(id) {
    const s = samples.find((x) => x.header.id === id)
    return { header: s.header, inheritedEventCount: 0, async read() { return { events: s.events } }, async close() {} }
  },
}
const { TokenUsageService } = await import('../../lib/types/index.js')
const { Service } = await import('@deepseek-ai/cordis')
const ctx = {
  sessionPersistence: sp,
  on() { return () => {} },
  effect(fn) { fn(); return () => {} },
  inject(services, cb) { cb({ get: () => undefined }); return { dispose() {} } },
  get() { return undefined },
}
const service = new TokenUsageService(ctx)
await service[Service.init]()
const start = Date.now()
while (service.progress.phase !== 'ready' && Date.now() - start < 30000) await new Promise((r) => setTimeout(r, 10))
const snap = service.getStats()
check('B1. service getStats 快照含 history 字段且为 null（未导入基线）', 'history' in snap && snap.history === null, snap.history)

const inv = TYPERT.invocations.find((i) => i.id === 'dsh-token-usage#tokenUsage/getStats')
const schema = inv.result.create()
let parsedSnap = null
try { parsedSnap = schema.parse(JSON.parse(JSON.stringify(snap))) } catch (e) { console.log('parse error', e.message) }
check('B2. typert schema 接受真实快照且保留 history=null', parsedSnap !== null && parsedSnap.history === null)
check('B3. schema 新增 history 为可空对象：接受真实 historyInfo', (() => {
  const withHistory = { ...snap, history: { label: 'x', range: ['2026-08-26', '2026-10-10'], totalTokens: 42135000000, estimatedDaily: true, importedAt: 123 } }
  try { const p = schema.parse(JSON.parse(JSON.stringify(withHistory))); return p.history && p.history.totalTokens === 42135000000 } catch (e) { console.log('history parse error', e.message); return false }
})())
check('B4. schema 拒绝缺少 history 的快照', (() => {
  const missing = { ...snap }; delete missing.history
  try { schema.parse(JSON.parse(JSON.stringify(missing))); return false } catch { return true }
})())
check('B5. schema 拒绝缺字段（importedAt）的 history 对象', (() => {
  const bad = { ...snap, history: { label: 'x', range: ['2026-08-26', '2026-10-10'], totalTokens: 1, estimatedDaily: true } }
  try { schema.parse(JSON.parse(JSON.stringify(bad))); return false } catch { return true }
})())

const failed = results.filter((r) => !r.ok)
console.log('\n通过', results.length - failed.length, '/', results.length)
process.exitCode = failed.length ? 1 : 0
