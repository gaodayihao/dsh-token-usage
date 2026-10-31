#!/usr/bin/env node
/**
 * 生成"历史基线"导入文件：把 2026-08-26 ~ 2026-10-10（磁盘损坏前）的数据
 * 按用户提供的截图还原成插件可合并的 JSON。
 *
 * 数据来源与可信度：
 *  - 总量 399.75 亿 / 峰值 23.09 亿 / 最长 9h57m / 连续 39 天 / 会话 1137 /
 *    消息 153,724 / 工具调用 194,617 / 工具种类 228 / Top 插件计数：
 *    截图文字与悬浮框直接读到，视为精确值（截至 2026-10-08 12:52）。
 *  - 每日 token：由截图热力图色阶还原（29 个有色日期），加上 8 个被悬浮框
 *    遮住的日期与 10-09/10-10 两个截图未覆盖的日期的估算值；非 9-23 的数值
 *    统一缩放，使 08-26~10-08 合计恰好等于 399.75 亿；9-23 固定为 27.89 亿
 *    （悬浮框精确值）。
 *  - 10-09/10-10 按该时段日均值估算（用户确认这两天也有使用，但截图未覆盖），
 *    因此基线总量略高于截图总量。
 *  - 连续天数：截图显示截至 10-08 已连续 39 天；10-09/10-10 也有活动，
 *    故 activeDates 覆盖 08-31 ~ 10-10（41 天），与现有真实数据连续后由面板重算。
 *
 * 用法：
 *   node scripts/history/build-baseline.mjs                 # 写入 DSH 数据目录 + 仓库副本
 *   node scripts/history/build-baseline.mjs --out <path>    # 只写入指定路径
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const YI = 1e8
/** 截图色阶 -> 该档日 token 估算值（亿），由总量+分位数结构+9-23 锚点线性拟合得到。 */
const LEVEL_VALUE = { 1: 3.07, 2: 8.03, 3: 13.0, 4: 17.96, 5: 22.93, 6: 27.89 }
/** 热力图可识别的 29 个有色日期（level 来自像素解析）。 */
const KNOWN_LEVELS = {
  '2026-08-26': 1, '2026-08-31': 1, '2026-09-01': 1, '2026-09-02': 1, '2026-09-12': 1, '2026-10-04': 1,
  '2026-08-28': 2, '2026-08-30': 2, '2026-09-03': 2, '2026-09-09': 2, '2026-09-11': 2,
  '2026-08-27': 3, '2026-08-29': 3, '2026-09-10': 3, '2026-09-13': 3, '2026-09-15': 3, '2026-09-29': 3, '2026-10-05': 3,
  '2026-09-16': 4, '2026-09-17': 4, '2026-09-20': 4, '2026-10-06': 4,
  '2026-09-14': 5, '2026-09-18': 5, '2026-09-19': 5, '2026-09-21': 5, '2026-09-22': 5, '2026-09-30': 5,
  '2026-09-23': 6,
}
/** 被截图悬浮框遮住的 8 个格子：按低值估算（不影响总量锚定）。 */
const HIDDEN_DAYS = ['2026-09-24', '2026-09-25', '2026-09-26', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-07', '2026-10-08']
const HIDDEN_VALUE = 2.0 * YI
/** 截图覆盖区间（精确总量截止 10-08 12:52）。 */
const CAPTURED_END = '2026-10-08'
const CAPTURED_TOTAL = 399.75 * YI
const MAX_DAY = '2026-09-23'
const MAX_DAY_VALUE = 27.89 * YI
/** 截图未覆盖、用户确认有使用的两天：按该时段日均估算。 */
const EXTRA_DAYS = { '2026-10-09': 10.8 * YI, '2026-10-10': 10.8 * YI }
/** 精确汇总（截图读取）。 */
const EXACT = {
  peakTokens: 23.09 * YI,
  maxDurationSec: 9 * 3600 + 57 * 60,
  totalConversations: 1137,
  totalMessages: 153724,
  totalToolCalls: 194617,
  distinctTools: 228,
  topPlugins: [
    ['pwsh', 49556],
    ['mcp__vs-mcp-ursa__FindSymbols', 5101],
    ['mcp__vs-mcp-ursa__FindSymbolUsages', 1145],
    ['mcp__vs-mcp-ursa__decompile', 1026],
    ['mcp__vs-mcp-ursa__GetSolutionTree', 774],
  ],
}
/** 连续天数：截图截至 10-08 连续 39 天 → 08-31~10-08；加上 10-09/10-10 共 41 天。 */
const ACTIVE_DATES = (() => {
  const out = []
  const start = new Date('2026-08-31T00:00:00')
  const end = new Date('2026-10-10T00:00:00')
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const pad = (n) => String(n).padStart(2, '0')
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
  }
  return out
})()

function round(value) { return Math.round(value) }

function buildDaily() {
  const daily = {}
  for (const [day, level] of Object.entries(KNOWN_LEVELS)) {
    if (day === MAX_DAY) continue
    daily[day] = LEVEL_VALUE[level] * YI
  }
  for (const day of HIDDEN_DAYS) daily[day] = HIDDEN_VALUE
  // 缩放非 9-23 的数值，使 08-26~10-08 合计 == 399.75 亿
  const otherSum = Object.values(daily).reduce((a, b) => a + b, 0)
  const target = CAPTURED_TOTAL - MAX_DAY_VALUE
  const scale = target / otherSum
  const scaled = {}
  for (const [day, value] of Object.entries(daily)) scaled[day] = round(value * scale)
  scaled[MAX_DAY] = round(MAX_DAY_VALUE)
  for (const [day, value] of Object.entries(EXTRA_DAYS)) scaled[day] = round(value)
  // 保证截图区间合计精确等于 399.75 亿（用 9-23 吸收四舍五入误差）
  const capturedSum = Object.entries(scaled).filter(([day]) => day <= CAPTURED_END).reduce((a, [, v]) => a + v, 0)
  scaled[MAX_DAY] += round(CAPTURED_TOTAL) - capturedSum
  return scaled
}

const dailyTokens = buildDaily()
const totalTokens = Object.values(dailyTokens).reduce((a, b) => a + b, 0)
const capturedSum = Object.entries(dailyTokens).filter(([day]) => day <= CAPTURED_END).reduce((a, [, v]) => a + v, 0)

const payload = {
  version: 1,
  label: '2026-08-26 ~ 2026-10-10（磁盘损坏前，按截图导入）',
  range: ['2026-08-26', '2026-10-10'],
  totalTokens,
  peakTokens: round(EXACT.peakTokens),
  maxDurationSec: EXACT.maxDurationSec,
  totalConversations: EXACT.totalConversations,
  totalMessages: EXACT.totalMessages,
  totalToolCalls: EXACT.totalToolCalls,
  distinctTools: EXACT.distinctTools,
  topPlugins: EXACT.topPlugins,
  totalSkillUses: 0,
  distinctSkills: 0,
  topSkills: [],
  dailyTokens,
  dailyEstimated: true,
  activeDates: ACTIVE_DATES,
  notes: [
    '总量/峰值/时长/会话/消息/工具计数来自 2026-10-08 12:52 的面板截图（精确）。',
    '每日 token 由热力图色阶还原 + 总量锚定缩放：08-26~10-08 合计 = 399.75 亿，9-23 固定 27.89 亿（截图悬浮框）。',
    '8 个被悬浮框遮挡的日期与 10-09/10-10 为估算值；10-09/10-10 用户确认有使用但截图未覆盖。',
    '连续天数按 08-31~10-10（41 天）与现有数据合并重算。',
  ].join(' '),
}

const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const targets = []
if (outIndex !== -1 && args[outIndex + 1]) {
  targets.push(args[outIndex + 1])
} else {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() ? process.env.DSH_HOME : join(homedir(), '.dsh')
  targets.push(join(home, 'storages', 'dsh-token-usage', 'history-baseline.v1.json'))
  targets.push(join(dirname(fileURLToPath(import.meta.url)), 'baseline-2026-08-26_2026-10-10.json'))
}
for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`[history] wrote ${target}`)
}
console.log(`[history] captured(08-26~10-08)=${(capturedSum / YI).toFixed(2)}亿 total(含10-09/10-10)=${(totalTokens / YI).toFixed(2)}亿 days=${Object.keys(dailyTokens).length}`)
