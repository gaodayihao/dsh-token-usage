/**
 * 交叉验证“旧参考实现”本身：直接加载 git HEAD 里已发布的旧构建产物
 * （lib/types/index.js，用 stub 的 cordis/typert），喂同一批解码会话，
 * 对比：
 *   A) 我的独立旧算法移植（old-ref.mjs）      —— 验证移植保真
 *   B) 新构建（lib/types/index.js）fallback 模式 —— 输出与新实现的差异
 */
import { listSessionFiles, loadSession } from './sessions.mjs'
import { OldAggregator } from './old-ref.mjs'

const files = listSessionFiles()
const LIMIT = Number(process.argv[2] || 20)
const picked = []
const stride = files.length / LIMIT
for (let i = 0; i < LIMIT; i++) picked.push(files[Math.min(files.length - 1, Math.floor(i * stride))])
const samples = picked.map((f) => loadSession(f))
console.log('样本数', samples.length)

function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  if (typeof a === 'object') {
    const ka = Object.keys(a).filter((k) => k !== 'updatedAt')
    const kb = Object.keys(b).filter((k) => k !== 'updatedAt')
    if (ka.length !== kb.length) return false
    return ka.every((k) => deepEqual(a[k], b[k]))
  }
  return false
}

/* A) 我的移植 */
const agg = new OldAggregator()
for (const s of samples) agg.backfillSession(s.header.id, s.header, s.events)
const portSnap = agg.snapshot()

/* B) 旧发布构建产物 */
const { default: OldService } = await import('./out/old-lib-build.mjs')
const { Service } = await import('@deepseek-ai/cordis')
const sp = {
  async list() { return samples.map((s) => ({ header: s.header, revision: 'rev-' + s.header.id })) },
  async open(id) {
    const s = samples.find((x) => x.header.id === id)
    return {
      header: s.header,
      async read() { return { events: s.events } },
      async close() {},
    }
  },
}
const listeners = []
const ctx = {
  sessionPersistence: sp,
  on(name, fn) { listeners.push({ name, fn }); return () => {} },
  effect(fn) { fn(); return () => {} },
  inject(services, cb) { cb({ get: () => undefined }); return { dispose() {} } },
  get() { return undefined },
}
const oldService = new OldService(ctx)
await oldService[Service.init]()
const start = Date.now()
while (!oldService.backfillDone && Date.now() - start < 60000) await new Promise((r) => setTimeout(r, 10))
const builtSnap = oldService.getStats()
console.log('旧构建 backfillDone', oldService.backfillDone)

/* C) 新构建（fallback 模式） */
const { TokenUsageService } = await import('../../lib/types/index.js')
const ctx2 = {
  sessionPersistence: sp,
  on(name, fn) { return () => {} },
  effect(fn) { fn(); return () => {} },
  inject(services, cb) { cb({ get: () => undefined }); return { dispose() {} } },
  get() { return undefined },
}
const newService = new TokenUsageService(ctx2)
await newService[Service.init]()
const start2 = Date.now()
while (newService.progress.phase !== 'ready' && Date.now() - start2 < 60000) await new Promise((r) => setTimeout(r, 10))
const newSnap = newService.getStats()

function diffFields(a, b) {
  const out = []
  for (const key of Object.keys(a)) {
    if (key === 'updatedAt') continue
    if (!deepEqual(a[key], b[key])) out.push([key, a[key], b[key]])
  }
  for (const key of Object.keys(b)) {
    if (key === 'updatedAt' || key in a) continue
    out.push([key, undefined, b[key]])
  }
  return out
}

const aVsB = diffFields(portSnap, builtSnap)
const portVsNew = diffFields(portSnap, newSnap)
console.log('\nA) 移植 vs 旧发布构建：', aVsB.length === 0 ? '完全一致' : JSON.stringify(aVsB, null, 1))
console.log('\nB) 移植（旧口径） vs 新构建：')
if (portVsNew.length === 0) console.log('完全一致')
else for (const [f, oldV, newV] of portVsNew) console.log(' -', f, 'old=', JSON.stringify(oldV), 'new=', JSON.stringify(newV))
console.log('\n关键数字 old(port):', JSON.stringify({ totalConversations: portSnap.totalConversations, totalMessages: portSnap.totalMessages, totalTokens: portSnap.totalTokens, peakTokens: portSnap.peakTokens, maxDurationSec: portSnap.maxDurationSec, currentStreak: portSnap.currentStreak, longestStreak: portSnap.longestStreak, thinking: portSnap.thinkingLevels }))
console.log('关键数字 new(build):', JSON.stringify({ totalConversations: newSnap.totalConversations, totalMessages: newSnap.totalMessages, totalTokens: newSnap.totalTokens, peakTokens: newSnap.peakTokens, maxDurationSec: newSnap.maxDurationSec, currentStreak: newSnap.currentStreak, longestStreak: newSnap.longestStreak, thinking: newSnap.thinkingLevels }))
process.exitCode = aVsB.length === 0 ? 0 : 1
