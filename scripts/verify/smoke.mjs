/**
 * 加载冒烟：验证 lib/ 构建产物能被 DSH（cordis/typert）加载并工作。
 *
 * 覆盖：
 *  1. lib/types/aggregate.js 与 src/aggregate.ts 行为一致（构建产物 == 源码）；
 *  2. lib/types/index.js 可导入，假 ctx + 假 sessionPersistence 跑通 fallback 模式 getStats；
 *  3. live 事件在 fallback 模式下继续折叠；
 *  4. 假投影服务 + 投影缓存跑通 projection 模式，并校验注册的单元契约；
 *  5. lib/typert.host.js 的 zod schema 接受真实快照（且 backfill 为必填）；
 *  6. lib/client.js 在假 window.__ModuleLoader__ + 假 react 下可加载，导出 apply/inject，
 *     apply() 能向 3 个 slot 注册组件。
 *
 * 只读仓库源码；DSH_HOME 指向 scripts/verify/out 下的临时目录，避免写真实 ~/.dsh。
 */
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listSessionFiles, loadSession } from './sessions.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'out')
const TMP_HOME = join(OUT, 'dsh-home')
rmSync(TMP_HOME, { recursive: true, force: true })
mkdirSync(TMP_HOME, { recursive: true })
process.env.DSH_HOME = TMP_HOME

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail })
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''))
}
function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    return ka.every((k) => deepEqual(a[k], b[k]))
  }
  return false
}
async function waitFor(fn, timeout, label) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (fn()) return true
    await new Promise((r) => setTimeout(r, 10))
  }
  console.log('TIMEOUT waiting for', label)
  return false
}

/* ── 准备样本会话 ─────────────────────────────────────────────────────────── */
const files = listSessionFiles()
const sampleFiles = [files[3], files[Math.floor(files.length / 3)], files[Math.floor(files.length / 2)], files[files.length - 2]]
const samples = sampleFiles.map((f) => loadSession(f))
console.log('样本会话', samples.map((s) => s.header.id))

/* ── 1. 构建产物 aggregate 与源码 aggregate 一致 ─────────────────────────── */
const src = await import('../../src/aggregate.ts')
const built = await import('../../lib/types/aggregate.js')
let aggregateBuildParity = true
let parityDetail = ''
for (const s of samples) {
  let a = src.createSessionState(s.header)
  let b = built.createSessionState(s.header)
  for (const ev of s.events) {
    a = src.applySessionEvent(a, ev)
    b = built.applySessionEvent(b, ev)
  }
  const va = src.sessionView(a)
  const vb = built.sessionView(b)
  if (!deepEqual(va, vb)) { aggregateBuildParity = false; parityDetail = s.header.id; break }
  const sa = JSON.parse(JSON.stringify(a))
  const sb = JSON.parse(JSON.stringify(b))
  if (!deepEqual(sa, sb)) { aggregateBuildParity = false; parityDetail = s.header.id + ' (state)'; break }
}
check('1. lib/types/aggregate.js 与 src/aggregate.ts 行为/状态一致', aggregateBuildParity, parityDetail)
check('1b. 两份 aggregate 的导出集合一致', deepEqual(Object.keys(src).sort(), Object.keys(built).sort()), Object.keys(built).sort())

/* ── 2. host 服务：fallback 模式 getStats ─────────────────────────────────── */
const { TokenUsageService, default: TokenUsageServiceDefault } = await import('../../lib/types/index.js')
check('2a. lib/types/index.js 可导入且导出 TokenUsageService', typeof TokenUsageService === 'function' && TokenUsageServiceDefault === TokenUsageService)

const { Service } = await import('@deepseek-ai/cordis')
check('2b. TokenUsageService 继承 TypertRemoteService 且声明 inject', TokenUsageService.inject && TokenUsageService.inject[0] === 'sessionPersistence', TokenUsageService.inject)

function makeFakeSp(sessions) {
  return {
    async list() {
      return sessions.map((s) => ({ header: s.header, revision: 'rev-' + s.header.id }))
    },
    async open(id) {
      const s = sessions.find((x) => x.header.id === id)
      if (!s) throw new Error('unknown session ' + id)
      return {
        header: s.header,
        inheritedEventCount: 0,
        async read() { return { events: s.events } },
        async close() {},
      }
    },
  }
}

function makeCtx({ sp, injectImpl, getImpl } = {}) {
  const listeners = []
  const disposers = []
  const ctx = {
    sessionPersistence: sp,
    on(name, fn) {
      listeners.push({ name, fn })
      return () => {
        const i = listeners.findIndex((l) => l.fn === fn)
        if (i >= 0) listeners.splice(i, 1)
      }
    },
    effect(fn) {
      const disposer = fn()
      disposers.push(disposer)
      return () => {}
    },
    inject(services, cb) {
      if (injectImpl) return injectImpl(cb, services)
      cb({ get: () => undefined })
      return { dispose() {} }
    },
    get(name) {
      return getImpl ? getImpl(name) : undefined
    },
  }
  return { ctx, listeners, disposers }
}

// 期望值：源码 aggregate 逐会话折叠
function localFold(s) {
  let state = src.createSessionState(s.header)
  for (const ev of s.events) state = src.applySessionEvent(state, ev)
  return src.sessionView(state)
}
const expectedViews = new Map(samples.map((s) => [s.header.id, localFold(s)]))
const expectedTokens = [...expectedViews.values()].reduce((a, v) => a + v.totalTokens, 0)
const expectedMessages = [...expectedViews.values()].reduce((a, v) => a + v.messageCount, 0)
const expectedThinking = [...expectedViews.values()].reduce((acc, v) => {
  for (const k of ['high', 'medium', 'low', 'off']) acc[k] += v.thinking[k]
  return acc
}, { high: 0, medium: 0, low: 0, off: 0 })

const fallback = makeCtx({ sp: makeFakeSp(samples) })
const service = new TokenUsageService(fallback.ctx)
await service[Service.init]()
const ready = await waitFor(() => service.progress.phase === 'ready', 15000, 'fallback ready')
check('2c. fallback 模式 bootstrap 到达 ready', ready, service.progress)
const snapFallback = service.getStats()
check('2d. fallback getStats totalConversations', snapFallback.totalConversations === samples.length, snapFallback.totalConversations + ' vs ' + samples.length)
check('2e. fallback getStats totalTokens 与源码折叠一致', snapFallback.totalTokens === expectedTokens, [snapFallback.totalTokens, expectedTokens])
check('2f. fallback getStats totalMessages 与源码折叠一致', snapFallback.totalMessages === expectedMessages, [snapFallback.totalMessages, expectedMessages])
check('2g. fallback getStats thinkingLevels 与源码折叠一致', deepEqual(snapFallback.thinkingLevels, expectedThinking), [snapFallback.thinkingLevels, expectedThinking])
check('2h. fallback 视图与源码 sessionView 一致', deepEqual([...service.views.values()].sort((a, b) => a.createdAt - b.createdAt), [...expectedViews.values()].sort((a, b) => a.createdAt - b.createdAt)))
check('2i. fallback 进度字段', snapFallback.backfill.mode === 'fallback' && snapFallback.backfill.total === samples.length && snapFallback.backfill.coldReads === samples.length, snapFallback.backfill)

/* ── 3. fallback 模式 live 事件继续折叠 ──────────────────────────────────── */
const liveId = 'live-session-1'
const liveHeader = { id: liveId, createdAt: Date.now() }
const liveUsage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 0, reasoningTokens: 0 }
const liveListener = fallback.listeners.find((l) => l.name === 'session/event')
const conn = liveListener ? liveListener.fn : null
const beforeTokens = service.getStats().totalTokens
if (conn) {
  conn({ id: liveId, header: liveHeader }, { seq: 1, type: 'request/header', time: Date.now(), data: { header: { config: { reasoningEffort: 'medium' } } } })
  conn({ id: liveId, header: liveHeader }, { seq: 2, type: 'assistant/message', time: Date.now(), data: { turn: 1, step: 1, usage: liveUsage, message: { source: { model: 'deepseek-v4.1-flash' } } } })
}
const snapLive = service.getStats()
check('3a. live 事件把 token 增量折叠进快照', snapLive.totalTokens === beforeTokens + 150, [beforeTokens, snapLive.totalTokens])
check('3b. live 事件建立新会话视图', snapLive.totalConversations === samples.length + 1, snapLive.totalConversations)
check('3c. live 会话 thinking 取 request/header 档位', snapLive.thinkingLevels.medium === expectedThinking.medium + 1, snapLive.thinkingLevels)

/* ── 3d. 没有 sessionPersistence 时的降级路径 ────────────────────────────── */
const emptyCtx = makeCtx({ sp: undefined })
const emptyService = new TokenUsageService(emptyCtx.ctx)
await emptyService[Service.init]()
const emptyReady = await waitFor(() => emptyService.progress.phase === 'ready', 5000, 'empty ready')
const emptySnap = emptyService.getStats()
check('3d. 无持久化服务时 getStats 仍可用（空快照）', emptyReady && emptySnap.totalConversations === 0 && emptySnap.totalTokens === 0 && emptySnap.backfill.phase === 'ready', emptySnap.backfill)

/* ── 4. projection 模式（缓存行 + 冷读） ─────────────────────────────────── */
const UNIT_KEY = 'dtsUsage'
const registeredUnits = []
const changedCbs = []
const cachedViews = new Map()
cachedViews.set(samples[0].header.id, localFold(samples[0]))
cachedViews.set(samples[1].header.id, localFold(samples[1]))
const projectedViews = new Map()
const projection = {
  register(unit) { registeredUnits.push(unit) },
  onChanged(cb) { changedCbs.push(cb); return () => {} },
  snapshot() { return undefined },
}
const cache = {
  cachedSnapshot(header) {
    const v = cachedViews.get(header.id)
    return v ? { values: { [UNIT_KEY]: v } } : undefined
  },
  coldSnapshot(header, inherited, events) {
    const s = samples.find((x) => x.header.id === header.id)
    const v = localFold(s)
    projectedViews.set(header.id, v)
    return { values: { [UNIT_KEY]: v } }
  },
}
const projectionCtx = makeCtx({
  sp: makeFakeSp(samples),
  injectImpl(cb) {
    cb({ get: (name) => (name === 'sessionProjections' ? projection : name === 'sessionProjectionCache' ? cache : undefined) })
    return { dispose() {} }
  },
})
const service2 = new TokenUsageService(projectionCtx.ctx)
await service2[Service.init]()
const ready2 = await waitFor(() => service2.progress.phase === 'ready', 15000, 'projection ready')
check('4a. projection 模式 bootstrap 到达 ready', ready2, service2.progress)
check('4b. projection 模式注册了 dtsUsage 单元', registeredUnits.length === 1 && registeredUnits[0].key === UNIT_KEY, registeredUnits.map((u) => u.key))
check('4c. 投影缓存命中数', service2.progress.fromCache === cachedViews.size, service2.progress)
check('4d. 冷读数', service2.progress.coldReads === samples.length - cachedViews.size, service2.progress)
const snapProjection = service2.getStats()
check('4e. projection 模式 totalTokens 与源码折叠一致', snapProjection.totalTokens === expectedTokens, [snapProjection.totalTokens, expectedTokens])
check('4f. projection 模式 totalConversations', snapProjection.totalConversations === samples.length, snapProjection.totalConversations)
check('4g. projection 快照带 backfill.mode=projection', snapProjection.backfill.mode === 'projection', snapProjection.backfill)

// 单元契约：init/apply/wire 与源码一致，schema 可校验
const unit = registeredUnits[0]
if (unit) {
  const s = samples[2]
  let state = unit.init(s.header)
  for (const ev of s.events) state = unit.apply(state, ev)
  const view = unit.wire.view(state)
  check('4h. 单元 init/apply/wire 与源码折叠一致', deepEqual(view, expectedViews.get(s.header.id)))
  let stateSchemaOk = true
  let viewSchemaOk = true
  try { unit.stateSchema.parse(JSON.parse(JSON.stringify(state))) } catch (e) { stateSchemaOk = false; console.log('stateSchema error:', e.message) }
  try { unit.wire.viewSchema.parse(JSON.parse(JSON.stringify(view))) } catch (e) { viewSchemaOk = false; console.log('viewSchema error:', e.message) }
  check('4i. 单元 stateSchema 接受真实状态', stateSchemaOk)
  check('4j. 单元 viewSchema 接受真实视图', viewSchemaOk)
  check('4k. 单元 key/version 稳定', unit.key === 'dtsUsage' && unit.stateVersion === 1, [unit.key, unit.stateVersion])
}

// projection 模式 live：onChanged 视图按会话替换，不累加
if (changedCbs.length === 1) {
  let liveState = src.createSessionState({ createdAt: Date.now() })
  liveState = src.applySessionEvent(liveState, {
    seq: 1, type: 'assistant/message', time: Date.now(),
    data: { turn: 1, step: 1, usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }, message: { source: { model: 'deepseek-v4.1-flash' } } },
  })
  const liveView = src.sessionView(liveState)
  changedCbs[0]({ id: 'proj-live-1' }, UNIT_KEY, liveView)
  const snapProjLive = service2.getStats()
  check('4m. projection onChanged 视图替换生效', snapProjLive.totalConversations === samples.length + 1 && snapProjLive.totalTokens === expectedTokens + 10, [snapProjLive.totalConversations, snapProjLive.totalTokens, expectedTokens])
} else {
  check('4m. projection onChanged 视图替换生效', false, 'onChanged 未注册: ' + changedCbs.length)
}

// 兜底持久化（fallback 服务）：flush 后文件可写且视图正确
try {
  service.schedulePersist()
  await service.flushFallbackStore()
  const storePath = join(TMP_HOME, 'storages', 'dsh-token-usage', 'session-rollup.v1.json')
  const store = existsSync(storePath) ? JSON.parse(readFileSync(storePath, 'utf8')) : null
  const first = samples[0].header.id
  const storeOk = Boolean(store && store.version === 1 && store.sessions && store.sessions[first])
    && deepEqual(store.sessions[first].view, expectedViews.get(first))
    && store.sessions[first].revision === 'rev-' + first
  check('4l. 兜底 rollup 持久化文件可写且视图正确', storeOk, storePath)
} catch (error) {
  check('4l. 兜底 rollup 持久化文件可写且视图正确', false, String(error && error.message || error))
}

/* ── 5. typert.host.js：schema 接受真实快照 ──────────────────────────────── */
const { TYPERT } = await import('../../lib/typert.host.js')
check('5a. TYPERT 清单存在 getStats 调用', TYPERT.package === 'dsh-token-usage' && TYPERT.face === 'host' && TYPERT.invocations.length >= 1, TYPERT.invocations.map((i) => i.id))
const invocation = TYPERT.invocations.find((i) => i.id === 'dsh-token-usage#tokenUsage/getStats')
let schemaOk = false
let schemaError = ''
let negativeOk = false
if (invocation) {
  const schema = invocation.result.create()
  try {
    const parsed = schema.parse(JSON.parse(JSON.stringify(snapFallback)))
    schemaOk = true
    // backfill 必须是 schema 的一部分（否则面板拿不到进度）
    const noBackfill = JSON.parse(JSON.stringify(snapFallback))
    delete noBackfill.backfill
    try { schema.parse(noBackfill) } catch { negativeOk = true }
    check('5b. schema 解析后保留 backfill 字段', parsed && parsed.backfill && typeof parsed.backfill.phase === 'string', parsed && parsed.backfill)
  } catch (error) {
    schemaError = String(error && error.message || error)
  }
}
check('5c. typert schema 接受 getStats 快照', schemaOk, schemaError)
check('5d. typert schema 要求 backfill 字段（缺字段应失败）', negativeOk)

/* ── 6. client.js：假 ModuleLoader + 假 react 加载 ───────────────────────── */
let loaderArgs = null
globalThis.window = {
  __ModuleLoader__: {
    load(def) { loaderArgs = def },
  },
  matchMedia: () => ({ matches: false }),
  innerWidth: 1280,
}
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ id: '', textContent: '', remove() {}, appendChild() {} }),
  head: { appendChild() {} },
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  documentElement: { dataset: {}, style: {} },
  body: { appendChild() {}, style: {} },
}
const reactStub = new Proxy({
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  Fragment: Symbol('Fragment'),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useRef: (v) => ({ current: v }),
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useSyncExternalStore: (_sub, get) => get(),
  memo: (c) => c,
  forwardRef: (c) => c,
  createContext: (v) => ({ Provider: (p) => p.children, Consumer: () => null, _value: v }),
  useContext: () => ({}),
  Children: { map: () => [], toArray: () => [], only: (c) => c },
  isValidElement: () => true,
  cloneElement: (c) => c,
}, {
  get(target, prop) {
    if (prop in target) return target[prop]
    if (prop === 'then') return undefined
    return (..._args) => null
  },
})
const fakeRequire = (id) => {
  if (id === 'react') return reactStub
  throw new Error('unexpected require: ' + id)
}
let clientLoaded = false
let clientError = ''
let clientModule = null
try {
  await import('../../lib/client.js')
  clientLoaded = loaderArgs !== null && typeof loaderArgs.factory === 'function'
  clientModule = clientLoaded ? loaderArgs.factory(fakeRequire) : null
} catch (error) {
  clientError = String(error && error.stack || error)
}
check('6a. client.js 调用 window.__ModuleLoader__.load', clientLoaded, clientError)
check('6b. client 导出 apply / inject', Boolean(clientModule && typeof clientModule.apply === 'function' && clientModule.inject), clientModule ? { apply: typeof clientModule.apply, inject: clientModule.inject } : null)

let applyOk = false
let applyError = ''
const slotRegistrations = []
const slotNames = []
const cleanups = []
if (clientModule && typeof clientModule.apply === 'function') {
  const clientCtx = {
    effect(fn) { const d = fn(); cleanups.push(d); return () => {} },
    get(name) {
      if (name === 'connection') {
        return { rpc: { call: async () => ({ ok: true, value: snapFallback }) } }
      }
      return undefined
    },
    slots: {
      inject(name, cb) { slotNames.push(name); return cb() },
      register(meta, component) { slotRegistrations.push({ meta, component }); return () => {} },
    },
  }
  try {
    clientModule.apply(clientCtx)
    await new Promise((r) => setTimeout(r, 30))
    applyOk = true
  } catch (error) {
    applyError = String(error && error.message || error)
  }
}
check('6c. client apply() 可运行', applyOk, applyError)
check('6d. client 注册 3 个 slot 入口', slotRegistrations.length === 3, slotRegistrations.map((r) => r.meta && r.meta.name))
check('6e. client inject 声明 slots/connection', deepEqual(clientModule && clientModule.inject, ['slots', 'connection']), clientModule && clientModule.inject)
for (const fn of cleanups) { try { if (typeof fn === 'function') fn() } catch {} }

/* ── 汇总 ─────────────────────────────────────────────────────────────────── */
const failed = results.filter((r) => !r.ok)
console.log('\n== 冒烟汇总 ==')
console.log('通过', results.length - failed.length, '/', results.length)
if (failed.length) {
  console.log('失败项:')
  for (const f of failed) console.log(' -', f.name, f.detail !== undefined ? JSON.stringify(f.detail) : '')
}
process.exitCode = failed.length ? 1 : 0
