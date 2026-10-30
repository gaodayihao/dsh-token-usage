/* Built from src/index.ts by scripts/build-lib.mjs — do not edit directly. */
/**
 * Token 统计面板 — Host 半边（Codex 风格）
 *
 * 数据链路（B 方案：DSH 投影缓存 + 增量折叠；A 方案兜底：插件自持久化）：
 *  - 增量：注册一个带 wire view 的 session 投影单元（`dtsUsage`），DSH 的
 *    `sessionProjections` 按事件增量驱动它，`sessionProjectionCache` 负责把
 *    每个会话的有界聚合按 `(sessionId, seq)` 持久化到 `session_projcache`。
 *    live 会话的更新通过 `sessionProjections.onChanged` 增量进入内存汇总。
 *  - 冷启动：遍历 `sessionPersistence.list()`，逐会话 `cachedSnapshot()`
 *    零日志 I/O 读缓存行；只有缓存未命中的会话才冷读一次原始日志
 *    （`coldSnapshot()` 会顺带把新 checkpoint 写回），之后永久命中。
 *  - 兜底：目标 DSH 没有投影/缓存服务时，插件自己把每会话聚合持久化到
 *    `~/.dsh/storages/dsh-token-usage/session-rollup.v1.json`，用
 *    `list()` 返回的 revision 做“没变就不重读”的增量判断。
 *  - RPC：`@Remote('getStats')` 返回内存汇总的缓存快照（dirty + 1s 节流），
 *    浏览器半边通过通用 RPC 通道调用 `tokenUsage/getStats`。
 *
 * 记账语义见 `./aggregate.ts`（对齐 DSH token-meter 的 tokenUsage 单元）：
 * 每会话只保留有界聚合（四类 token 桶、按天桶、thinking/模型/工具/skill
 * 计数、消息时间线标量），内存与“会话有多长”解耦；同一步的重复结算按替换
 * 记账，不重复计数。
 * @module @deepseek-ai/dsh-token-usage
 */

import { Service } from '@deepseek-ai/cordis'

import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'


import { z } from 'zod'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { applySessionEvent, buildGlobalSnapshot, createSessionState, sessionView } from './aggregate.js'











/** 投影单元 key（持久化在 session_projcache 的每会话记录里）。 */
const UNIT_KEY = 'dtsUsage'
/** 投影单元状态版本：折叠语义变化时 +1，旧行会被 DSH 视为不可用并重折。 */
const UNIT_VERSION = 1
/** 冷读日志时的并发度（单个大日志解压后几十 MB，别开太大）。 */
const COLD_READ_CONCURRENCY = 2
/** getStats 快照最短重算间隔（毫秒）。 */
const SNAPSHOT_TTL_MS = 1000
/** 等待 DSH 投影服务就绪的上限（毫秒），超时即走兜底模式。 */
const SERVICE_WAIT_MS = 4000
/** 兜底模式：日志 revision 未变则跳过重读。 */
const FALLBACK_STORE_VERSION = 1
const FALLBACK_FLUSH_DELAY_MS = 2000

/* ── 投影单元 schema（plain JSON，可被 DSH 持久化校验） ─────────────────── */

const bucketsSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
})

const thinkingSchema = z.object({
  high: z.number(),
  medium: z.number(),
  low: z.number(),
  off: z.number(),
})

const unitStateSchema = z.object({
  createdAt: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  days: z.record(z.string(), z.number()),
  thinking: thinkingSchema,
  models: z.record(z.string(), z.number()),
  tools: z.record(z.string(), z.number()),
  skills: z.record(z.string(), z.number()),
  messageCount: z.number(),
  lastMsgTime: z.number().nullable(),
  segStart: z.number().nullable(),
  maxSeg: z.number(),
  effort: z.string().nullable(),
  effortKnown: z.boolean(),
  early: thinkingSchema,
  last: z.object({
    turn: z.number(),
    step: z.number(),
    day: z.string(),
    total: z.number(),
    buckets: bucketsSchema,
  }).nullable(),
})

const unitViewSchema = z.object({
  createdAt: z.number(),
  totalTokens: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  days: z.record(z.string(), z.number()),
  thinking: thinkingSchema,
  models: z.record(z.string(), z.number()),
  tools: z.record(z.string(), z.number()),
  skills: z.record(z.string(), z.number()),
  messageCount: z.number(),
  lastMsgTime: z.number().nullable(),
  segStart: z.number().nullable(),
  maxSeg: z.number(),
})

/* ── DSH 服务的结构化视图（只用到的方法，避免硬依赖内部类型包） ─────────── */













































/* ── 小工具 ─────────────────────────────────────────────────────────────── */

function num(value         )         {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function warn(message        )       {
  // 插件是 fail-soft 的：统计失败不应该影响 DSH 主流程。
  console.warn(`[token-usage] ${message}`)
}

function yieldToEventLoop()                {
  return new Promise(resolve => {
    setImmediate(resolve)
  })
}

/** DSH 数据根目录（`~/.dsh`，可用 DSH_HOME 覆盖）。 */
function dshHome()         {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv
  return join(homedir(), '.dsh')
}

/** 兜底模式的本地持久化文件。派生数据，损坏/丢失只会导致一次全量回填。 */
function fallbackStorePath()         {
  return join(dshHome(), 'storages', 'dsh-token-usage', `session-rollup.v${FALLBACK_STORE_VERSION}.json`)
}

/** 日志 revision 是否可复用（两个 revision 都非空且相等）。 */
function sameRevision(left         , right         )          {
  return typeof left === 'string' && typeof right === 'string' && left !== '' && left === right
}

/**
 * 只读统计服务：维护“每会话有界聚合 -> 全局汇总”的内存 rollup，并通过
 * Typert Remote 暴露给浏览器面板。不创建、不恢复任何 Agent / Session。
 */
export class TokenUsageService extends TypertRemoteService {
  static inject = ['sessionPersistence']

  /** sessionId -> 单会话视图（rollup 的唯一真相源）。 */
                   views = new Map                     ()
  /** 兜底模式：sessionId -> 折叠状态（live 继续折叠用）。 */
                   states = new Map                          ()
  /** 兜底模式：sessionId -> 已折叠的最高 seq。 */
                   foldedSeq = new Map                ()
  /** 兜底模式：本次扫描到的会话 id，用于区分“待冷读”与“启动后新建”。 */
                   listed = new Set        ()
  /** 兜底模式：冷读前缓冲的 live 事件。 */
                   pending = new Map                        ()
  /** 兜底模式：sessionId -> 最近一次 list() 看到的日志 revision。 */
                   revisions = new Map                ()
  /** 当前回填进度（面板展示“统计中 x/y”）。 */
          progress                   = {
    phase: 'idle', done: 0, total: 0, fromCache: 0, coldReads: 0, mode: 'projection',
  }
  /** 数据源模式：DSH 投影缓存 / 插件自持久化兜底。 */
          mode                            = 'projection'
  /** 最近一次汇总快照（dirty + TTL 节流）。 */
          cachedSnapshot                            = null
          dirty = true
          lastBuildAt = 0
          projection                                = null
          cache                             = null
          coldQueue                     = []
  /** 兜底模式：会话载入时按需重读日志所需的持久化句柄。 */
          persistence                                                                       = null
  /** 兜底模式：正在按需重读的会话（避免重复重读）。 */
                   refreshing = new Set        ()
          started = false
          disposed = false
          persistTimer                                       = null
          persistPending = false
                   disposers                    = []
                   storePath

  /**
   * @param ctx - Host context carrying session persistence.
   */
  constructor(ctx         ) {
    super(ctx, 'tokenUsage')
    this.storePath = fallbackStorePath()
  }

  /** 挂载 live 订阅并后台启动 bootstrap（不阻塞插件激活）。 */
  ;         async [Service.init]()                {
    const sp = this.ctx.sessionPersistence
    const offLive = this.ctx.on('session/event', (session         , event              ) => {
      this.onLiveEvent(session, event)
    })
    const offCreated = this.ctx.on('session/created', (session         ) => {
      this.onSessionCreated(session)
    })
    this.ctx.effect(() => () => {
      this.disposed = true
      this.started = false
      offLive()
      offCreated()
      for (const dispose of this.disposers) {
        try {
          dispose()
        } catch {
          // ignore
        }
      }
      this.disposers.length = 0
      if (this.persistTimer !== null) clearTimeout(this.persistTimer)
      this.persistTimer = null
    }, 'dsh-token-usage: lifecycle')
    void this.bootstrap(sp)
  }

  /** 决定数据源模式并启动回填。 */
          async bootstrap(sp                                )                {
    this.started = true
    if (!sp || typeof (sp                                 ).list !== 'function') {
      warn('sessionPersistence unavailable — statistics stay empty')
      this.progress.phase = 'ready'
      this.dirty = true
      return
    }
    this.progress.phase = 'scanning'
    this.dirty = true
    this.persistence = sp
    try {
      const ready = await this.waitForProjectionServices()
      if (this.disposed) return
      if (ready) {
        this.mode = 'projection'
        this.progress.mode = 'projection'
        await this.bootstrapProjection(sp                                                                                                                 )
      } else {
        this.mode = 'fallback'
        this.progress.mode = 'fallback'
        await this.bootstrapFallback(sp                                                                                                                 )
      }
    } catch (error) {
      warn(`bootstrap failed: ${error instanceof Error ? error.message : String(error)}`)
      this.progress.phase = 'ready'
      this.dirty = true
    }
  }

  /**
   * 等待 DSH 的投影服务与投影缓存服务就绪；就绪时注册单元并订阅变更。
   * 超时/服务缺失返回 false（走兜底模式）。
   */
          waitForProjectionServices()                   {
    return new Promise         (resolve => {
      let settled = false
      let fiber                                  = null
      const finish = (ready         )       => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (!ready) {
          try {
            fiber?.dispose?.()
          } catch {
            // ignore
          }
        }
        resolve(ready)
      }
      const timer = setTimeout(() => finish(false), SERVICE_WAIT_MS)
      try {
        fiber = this.ctx.inject(['sessionProjections', 'sessionProjectionCache'], (injected         ) => {
          if (settled || this.disposed) return
          const projection = injected.get('sessionProjections')
          const cache = injected.get('sessionProjectionCache')
          if (!projection || typeof projection.register !== 'function' || !cache || typeof cache.cachedSnapshot !== 'function') {
            finish(false)
            return
          }
          try {
            this.registerUnit(projection)
            if (typeof projection.onChanged === 'function') {
              const dispose = projection.onChanged((session, key, value) => {
                if (key !== UNIT_KEY) return
                this.onProjectionChanged(session, value)
              })
              if (typeof dispose === 'function') this.disposers.push(dispose)
            }
            this.projection = projection
            this.cache = cache
            finish(true)
          } catch (error) {
            warn(`projection registration failed: ${error instanceof Error ? error.message : String(error)}`)
            finish(false)
          }
        })
      } catch (error) {
        warn(`projection services unavailable: ${error instanceof Error ? error.message : String(error)}`)
        finish(false)
      }
    })
  }

  /** 注册 `dtsUsage` 投影单元（有界状态 + wire view）。 */
          registerUnit(projection                        )       {
    projection.register({
      key: UNIT_KEY,
      stateVersion: UNIT_VERSION,
      stateSchema: unitStateSchema,
      init: (header                                    ) => createSessionState(header),
      apply: (state                  , event              ) => applySessionEvent(state, event),
      wire: {
        viewSchema: unitViewSchema,
        view: (state                  ) => sessionView(state),
      },
    })
  }

  /** live 会话的投影视图变化：直接替换该会话贡献（不累加，避免双算）。 */
          onProjectionChanged(session         , value         )       {
    const id = session?.id
    if (!id || this.mode !== 'projection') return
    if (!value || typeof value !== 'object') return
    this.views.set(id, value               )
    this.dirty = true
  }

  /** B 方案：缓存行优先，未命中才冷读原始日志。 */
          async bootstrapProjection(sp                                                                                                    )                {
    const snapshots = await sp.list()
    const list = Array.isArray(snapshots) ? snapshots : []
    this.progress.total = list.length

    // 1) 本进程内已经 live 的会话：读实时投影（可能比缓存行新）。
    const store = this.ctx.get('sessions')
    if (store && typeof store.list === 'function') {
      for (const session of store.list()) {
        try {
          const block = this.projection?.snapshot?.(session, [UNIT_KEY])
          const value = block?.values?.[UNIT_KEY]
          if (value) this.views.set(session.id, value               )
        } catch (error) {
          warn(`live snapshot failed for ${session.id}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }

    // 2) 逐个会话读投影缓存行（零日志 I/O）；未命中进入冷读队列。
    for (const entry of list) {
      const id = entry?.header?.id
      if (!id) continue
      this.listed.add(id)
      if (this.views.has(id)) continue
      let block
      try {
        block = this.cache?.cachedSnapshot(entry.header, [UNIT_KEY])
      } catch (error) {
        warn(`cached projection read failed for ${id}: ${error instanceof Error ? error.message : String(error)}`)
        block = undefined
      }
      const value = block?.values?.[UNIT_KEY]
      if (value) {
        this.views.set(id, value               )
        this.progress.fromCache += 1
      } else {
        this.coldQueue.push(entry)
      }
    }

    this.progress.done = Math.max(0, list.length - this.coldQueue.length)
    this.dirty = true
    if (this.coldQueue.length > 0) {
      this.progress.phase = 'backfilling'
      await this.drainColdQueue(sp, true)
    }
    this.progress.phase = 'ready'
    this.dirty = true
  }

  /** 冷读队列：并发度受控、每批之后让出事件循环、按会话创建时间从新到旧。 */
          async drainColdQueue(
    sp                                                               ,
    projectionMode         ,
  )                {
    const queue = this.coldQueue
    this.coldQueue = []
    queue.sort((left, right) => num(right?.header?.createdAt) - num(left?.header?.createdAt))
    let cursor = 0
    const worker = async ()                => {
      for (;;) {
        if (this.disposed) return
        const entry = queue[cursor]
        cursor += 1
        if (!entry || !entry.header?.id) return
        const startedAt = performance.now()
        try {
          await this.coldReadSession(sp, entry, projectionMode)
        } catch (error) {
          warn(`cold read failed for ${entry.header.id}: ${error instanceof Error ? error.message : String(error)}`)
        }
        this.progress.done += 1
        this.dirty = true
        if (performance.now() - startedAt > 40) await yieldToEventLoop()
      }
    }
    const workers                       = []
    for (let i = 0; i < COLD_READ_CONCURRENCY; i++) workers.push(worker())
    await Promise.all(workers)
  }

  /** 冷读一个会话：优先让 DSH 投影缓存折叠并写回，缺失时本地折叠兜底。 */
          async coldReadSession(
    sp                                                               ,
    entry                  ,
    projectionMode         ,
  )                {
    const id = entry.header?.id
    if (!id) return
    const handle = await sp.open(id, 'read')
    try {
      const result = await handle.read(0)
      const events = Array.isArray(result?.events) ? result.events : []
      const header = (handle.header ?? entry.header)
      const inherited = typeof handle.inheritedEventCount === 'number' ? handle.inheritedEventCount : 0
      let value
      if (projectionMode && this.cache) {
        try {
          const cut = this.cache.coldSnapshot(header, inherited, events)
          value = cut?.values?.[UNIT_KEY]
        } catch (error) {
          warn(`cold projection failed for ${id}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (value && typeof value === 'object') {
        this.views.set(id, value               )
        this.progress.coldReads += 1
        return
      }
      // 兜底：本地折叠（写回失败/非投影模式时也保证数字正确）。
      let state = createSessionState(header)
      for (const event of events) state = applySessionEvent(state, event)
      this.views.set(id, sessionView(state))
      this.states.set(id, state)
      this.foldedSeq.set(id, events.length > 0 ? num(events[events.length - 1]?.seq) : -1)
      this.progress.coldReads += 1
      this.drainFallbackPending(id)
    } finally {
      try {
        await handle.close()
      } catch {
        // ignore
      }
    }
  }

  /** A 方案兜底：用自己的持久化 rollup + 日志 revision 做增量。 */
          async bootstrapFallback(sp                                                                                                    )                {
    const store = await this.loadFallbackStore()
    const snapshots = await sp.list()
    const list = Array.isArray(snapshots) ? snapshots : []
    this.progress.total = list.length
    for (const entry of list) {
      const id = entry?.header?.id
      if (!id) continue
      this.listed.add(id)
      if (typeof entry.revision === 'string' && entry.revision) this.revisions.set(id, entry.revision)
      const record = store?.sessions?.[id]
      if (record && record.view && sameRevision(record.revision, entry.revision)) {
        this.views.set(id, record.view)
        this.progress.fromCache += 1
      } else {
        this.coldQueue.push(entry)
      }
    }
    this.progress.done = Math.max(0, list.length - this.coldQueue.length)
    this.dirty = true
    if (this.coldQueue.length > 0) {
      this.progress.phase = 'backfilling'
      await this.drainColdQueue(sp, false)
    }
    this.progress.phase = 'ready'
    this.dirty = true
    this.schedulePersist()
  }

  /** live 事件：投影模式由 onChanged 驱动，这里只服务兜底模式。 */
          onLiveEvent(session         , event              )       {
    if (this.mode !== 'fallback' || this.disposed) return
    const id = session?.id
    if (!id || typeof event?.seq !== 'number') return
    if (this.states.has(id)) {
      this.foldFallbackEvent(id, event)
      return
    }
    if (this.listed.has(id)) {
      const buffered = this.pending.get(id) ?? []
      buffered.push(event)
      this.pending.set(id, buffered)
      // 会话在启动后第一次载入：按需重读一次日志拿到完整折叠状态，再消化缓冲事件。
      this.ensureFallbackState(id, session.header)
      return
    }
    // 启动后新建的会话：从空状态开始折叠。
    this.states.set(id, createSessionState(session.header))
    this.foldedSeq.set(id, -1)
    this.foldFallbackEvent(id, event)
  }

  /** 会话载入（attach）时同步该会话的视图：投影模式读实时 cell，兜底模式按需重读。 */
          onSessionCreated(session         )       {
    const id = session?.id
    if (!id || this.disposed) return
    if (this.mode === 'projection' && this.projection) {
      try {
        const block = this.projection.cachedSnapshot?.(session, [UNIT_KEY])
        const value = block?.values?.[UNIT_KEY]
        if (value && typeof value === 'object') {
          this.views.set(id, value               )
          this.dirty = true
        }
      } catch (error) {
        warn(`live projection read failed for ${id}: ${error instanceof Error ? error.message : String(error)}`)
      }
      return
    }
    if (this.mode === 'fallback' && !this.states.has(id) && this.listed.has(id)) {
      // 兜底模式下，缓存复用的会话在真正载入时重读日志，拿到可继续折叠的完整状态。
      this.ensureFallbackState(id, session.header)
    }
  }

  /** 兜底模式：按需重读一个会话的完整日志（用于会话载入后继续增量折叠）。 */
          ensureFallbackState(id        , header                         )       {
    if (this.refreshing.has(id) || this.persistence === null || this.disposed) return
    this.refreshing.add(id)
    void (async () => {
      try {
        await this.reloadFallbackSession(id, header)
      } catch (error) {
        warn(`fallback reload failed for ${id}: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        this.refreshing.delete(id)
      }
    })()
  }

  /** 兜底模式：重读一个会话日志并从零折叠（不重复计入进度）。 */
          async reloadFallbackSession(id        , header                         )                {
    const persistence = this.persistence
    if (persistence === null) return
    const handle = await persistence.open(id, 'read')
    try {
      const result = await handle.read(0)
      const events = Array.isArray(result?.events) ? result.events : []
      const resolvedHeader = (handle.header ?? header)
      let state = createSessionState(resolvedHeader)
      for (const event of events) state = applySessionEvent(state, event)
      this.states.set(id, state)
      this.foldedSeq.set(id, events.length > 0 ? num(events[events.length - 1]?.seq) : -1)
      this.views.set(id, sessionView(state))
      this.dirty = true
      this.schedulePersist()
      this.drainFallbackPending(id)
    } finally {
      try {
        await handle.close()
      } catch {
        // ignore
      }
    }
  }

  /** 兜底模式：按 seq 水位折叠一条 live 事件。 */
          foldFallbackEvent(id        , event              )       {
    const maxSeq = this.foldedSeq.get(id) ?? -1
    if (event.seq <= maxSeq) return
    const state = this.states.get(id) ?? createSessionState()
    const next = applySessionEvent(state, event)
    this.states.set(id, next)
    this.foldedSeq.set(id, event.seq)
    this.views.set(id, sessionView(next))
    this.dirty = true
    this.schedulePersist()
  }

  /** 冷读完成后消化该会话缓冲的 live 事件。 */
          drainFallbackPending(id        )       {
    const buffered = this.pending.get(id)
    if (!buffered) return
    this.pending.delete(id)
    for (const event of buffered) this.foldFallbackEvent(id, event)
  }

  /** 兜底模式持久化：读取本地 rollup（损坏/缺失时返回 undefined）。 */
          async loadFallbackStore()                                     {
    try {
      const raw = await readFile(this.storePath, 'utf8')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return undefined
      if (parsed.version !== FALLBACK_STORE_VERSION) return undefined
      const sessions = parsed.sessions
      if (!sessions || typeof sessions !== 'object') return undefined
      return { version: FALLBACK_STORE_VERSION, sessions: sessions                                   }
    } catch {
      return undefined
    }
  }

  /** 兜底模式持久化：防抖写入（原子替换）。 */
          schedulePersist()       {
    if (this.mode !== 'fallback' || this.disposed) return
    this.persistPending = true
    if (this.persistTimer !== null) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void this.flushFallbackStore()
    }, FALLBACK_FLUSH_DELAY_MS)
    const timer = this.persistTimer
    if (typeof timer.unref === 'function') timer.unref()
  }

  /** 把当前 rollup 写回本地文件（失败不影响统计）。 */
          async flushFallbackStore()                {
    if (!this.persistPending || this.mode !== 'fallback' || this.disposed) return
    this.persistPending = false
    const sessions                                 = {}
    for (const [id, view] of this.views) {
      sessions[id] = { revision: this.revisions.get(id) ?? '', view }
    }
    const payload                = { version: FALLBACK_STORE_VERSION, sessions }
    try {
      await mkdir(dirname(this.storePath), { recursive: true })
      const tempPath = `${this.storePath}.tmp`
      await writeFile(tempPath, JSON.stringify(payload), 'utf8')
      await rename(tempPath, this.storePath)
    } catch (error) {
      warn(`fallback store write failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 读取当前聚合快照。
   * @returns 全部 session 的 token 用量汇总（纯 JSON）。
   */
  getStats()                     {
    const now = Date.now()
    if (this.cachedSnapshot === null || this.dirty || now - this.lastBuildAt >= SNAPSHOT_TTL_MS) {
      const progress                   = {
        ...this.progress,
        done: Math.min(this.progress.done, this.progress.total || this.progress.done),
      }
      this.cachedSnapshot = buildGlobalSnapshot(this.views.values(), progress)
      this.dirty = false
      this.lastBuildAt = now
    }
    return this.cachedSnapshot
  }
}

export default TokenUsageService


//# sourceURL=src/index.ts