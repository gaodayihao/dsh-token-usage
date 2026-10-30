# dsh-token-usage 独立验证报告

**结论：新实现与旧实现数字一致。** 在 910 个真实会话日志上逐会话、全局全部字段对拍为 **0 差异**
（0 个差异会话、0 个差异字段、0 个全局差异、0 解码失败）。构建产物在桩环境下可加载，
projection / fallback 两种数据源模式均可跑通 \`getStats\`，typert zod schema 与 client 打包产物均通过冒烟。

- 验证时间：2026-10-30 22:37–22:56（Asia/Shanghai）
- 运行环境：Windows，Node v24.3.0（原生 \`zstdDecompressSync\` + TypeScript 直跑）
- 被验版本（sha256，完成时刻）：
  - \`src/aggregate.ts\` \`58d4beed304940e5ace162e4b46e221414a0fbf14cf837b2056146cda88fc659\`
  - \`lib/types/aggregate.js\` \`676e0e0aac13f3889d04d8b06456899bf33cd08a08ac88d062b4cd18623de41f\`
  - \`lib/types/index.js\` \`4b4d2e670f27ff70d2af99eda4553a2999922651619a19784a2d4598858ea41a\`
  - \`lib/typert.host.js\` \`8680ed6d432110ef7e4fc9436382b911fb6a137ca2cfd2c0db3b3070a21c6a0e\`
  - \`lib/client.js\` \`9e3c80aeb303fe55609b3b2c2b89fa720963ad2c50409cf5436ed77381bde019\`
- 旧实现基准：\`git HEAD:src/index.ts\`（HEAD = 7c9129a）

> 验证后说明（Lead）：验证完成后只对 `lib/` 生成物做了行尾空白清理（whitespace-only，
> 去空白后 token 流与服务端代码完全一致，`src/*` 哈希未变），并重跑 `node scripts/verify/smoke.mjs`
> 得到 37/37 通过；上面记录的 `lib` 哈希是验证时刻的产物哈希，与仓库最终提交的
> whitespace-clean 产物不同，但语义等价。

## 1. 数据与解码

- 日志：\`C:\Users\Ellis\.dsh\sessions\<workspace>\<sessionId>\session.v4.jsonl.zstd\`
- 规模：**910** 个会话文件（验证期间语料仍在增长：907 → 909 → 910；单文件最大约百 MB）
- 解码：\`scripts/verify/zstd.mjs\` 自实现多帧 zstd 解析（帧 magic/descriptor/window/dict/contentSize/
  块头/checksum 逐帧定位，逐帧 \`zstdDecompressSync\` 后拼接），0 解码失败、0 坏行
- 解析：首行 \`{"type":"session",...}\` 为头部（含 \`id\`/\`createdAt\`），其余为事件（\`seq/type/time/data\`）
- 旧参考实现：\`scripts/verify/old-ref.mjs\` 独立移植 HEAD \`src/index.ts\` 的折叠与快照口径
  （stepUsage 键、message 覆盖、header effort 前置兜底、>30min 切段、日期桶、streak、工具/skill 计数等），
  **不 import 旧源码**，仅按语义重写

### 参考实现保真交叉验证

\`scripts/verify/old-build-oracle.mjs\` 用 \`git show HEAD:lib/types/index.js\`（已发布的旧构建）
在本仓库 \`node_modules\` 桩（cordis/typert）下真实运行，喂 20 个抽样会话：

- 我的独立移植 vs 旧发布构建：快照**逐字段完全一致**（除 \`updatedAt\`）
- 旧发布构建 vs 新构建 fallback：除新增 \`backfill\` 字段外一致

→ 对拍基准可信，不是"自己和自己比"。

## 2. 全量对拍（910 会话，逐会话 + 全局）

对拍范围（\`scripts/verify/compare.mjs\`）：

- 逐会话：\`inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens/totalTokens\`、\`days\`、\`thinking\`、
  \`models\`、\`tools\`、\`skills\`、\`messageCount\`、\`lastMsgTime\`、\`segStart\`、\`maxSeg\`、\`createdAt\`
- 全局：\`totalConversations/totalMessages/totalTokens/peakTokens/maxDurationSec/maxDurationText/
  currentStreak/longestStreak/dailyTokens/thinkingLevels/totalToolCalls/distinctTools/topPlugins/
  topSkills/totalSkillUses/distinctSkills/modelBreakdown/earliestDate/latestDate\`

结果（\`scripts/verify/out/full-report2.json\`）：

\`\`\`
compared: 910   sessionsWithDiffs: 0   diffFieldCount: 0
globalDiffs: []   decodeFailures: 0   badLines: 0
\`\`\`

对拍时刻 old == new 的关键数字：

| 指标 | 值 |
| --- | --- |
| 会话数 | 910 |
| 消息数 | 99,012 |
| 累计 token | 21,302,316,446 |
| 单会话峰值 | 270,703,830 |
| 最长聊天段 | 17,156.694s（4小时 45分） |
| 连续天数（当前/最长） | 20 / 20 |
| 工具调用 / 种类 | 93,530 / 81 |
| skill 使用 / 种类 | 14 / 4 |
| thinking 档位 | high 83,772 / medium 0 / low 783 / off 1,289 |
| 活跃日期 | 2026-10-11 → 2026-10-30（20 天） |

最新一次全量快照（\`scripts/verify/out/snapshot-final.log\`，语料增长后重算）：
910 会话 / 99,035 消息 / 21,307,962,690 token / peak 270,703,830 / 4小时45分 /
streak 20,20 / 工具 93,551·81 / skill 14·4 / thinking {high 83,793, medium 0, low 783, off 1,289} /
modelBreakdown {DeepSeek: 85,865} / dailyTokens 20 天、合计与总量一致。

## 3. 差异与修复验证

### 修复前（src/aggregate.ts @ 22:40）：1 个可解释差异

唯一差异会话：\`session-19bbdacf-7861-4641-85b4-54f8005f83ed\`（createdAt 2026-10-15T07:43:21Z）。

- 该会话共有 3 个 \`request/header\`：seq 12（reason=initial）、seq 808（reason=resume）均**不带**
  \`config.reasoningEffort\`；seq 822（reason=change）才出现 \`"high"\`
- 其前 100 次结算（分布 2026-10-15、2026-10-27 两天）：
  - 旧实现回填前会预扫描"整条日志第一个明确档位"并作为前置兜底 → 这 100 步全部记为 **high**
  - 修复前新实现只在事件流已出现的档位上取值，缺失时回退 \`reasoningTokens\` 近似；
    该 provider 不上报 reasoningTokens（缺失/0）→ 全部记为 **off**
- 全量影响：thinking high 83,709 → 83,609、off 1,289 → 1,389；其余所有字段（含 token 四桶、天数、
  模型、工具、skill、消息、时长、streak）**完全一致**。占全量 thinking 记录 100/85,781 ≈ 0.12%

### 修复后（src/aggregate.ts @ 22:48，新增 effortKnown/early 有界字段+迁移）

- 全量 910 重跑：**0 差异**，\`fieldCounts\`、\`classCounts\`、\`globalDiffs\` 均为空
- 该会话 thinking 现为 \`{high:133, medium:0, low:0, off:0}\`，与旧实现一致
- 边界检查：全量 \`request/header\` 的 reasoningEffort 取值只有 \`"high"\`(2328)、\`"low"\`(15)、缺失(31)，
  不存在不可映射字符串，因此"首个非空档位不可映射时旧实现不迁移、新实现会迁移"这一理论分歧在本语料
  **不可达**；旧实现的"首个明确档位兜底"语义被完整复刻

## 4. 新语义（attempt/retry/stream）为什么没有造成数字差

新实现按 DSH token-meter 口径额外处理以下事件；本语料中它们**均未触发实际增量**，属"潜在可解释差异"：

| 语义点 | 语料统计 | 结果 |
| --- | --- | --- |
| \`assistant/attempt\` 内嵌 stream usage | 459 个 attempt，242 个含 usage，**非零 0 个** | 可计入量恒为 0，不影响 token |
| \`llm/retry-started\` 复位 last 槽 | 283 个 | 被复位的都是 0 值 attempt，总量不变 |
| \`assistant/message\` 缺 \`data.usage\` 回退 stream | 19 条缺失，其中 stream 含 usage 的 **0 条** | 回退路径未生效 |
| 同 (turn,step) 重复结算（只保留"上一笔"槽） | 存在 attempt→message、重试等重复 | 全量 token 桶完全一致 → 无非相邻重复导致双计 |

结论：本语料的数字与旧实现一致；但若未来 provider 在失败/重试 attempt 内返回**非零** usage，
新实现会按 token-meter 口径计入（旧实现忽略），这是有意的**语义变更**，建议在 CHANGELOG 中写明。

## 5. 加载冒烟（37/37 通过）

\`scripts/verify/smoke.mjs\`；桩位于 \`node_modules/@deepseek-ai/{cordis,dsh-typert-protocol}\`（gitignore），
zod 从 DSH profile 复制；\`DSH_HOME\` 指向 \`scripts/verify/out/dsh-home\`，不写真实 \`~/.dsh\`。

1. **构建产物 = 源码**：\`lib/types/aggregate.js\` 与 \`src/aggregate.ts\` 在抽样会话上逐事件折叠后
   state/view 深度相等，导出集合一致。
2. **host 服务 fallback 模式**：\`lib/types/index.js\` 可导入；假 \`sessionPersistence\`（4 会话）下
   bootstrap 到 \`{phase:ready, total:4, coldReads:4, mode:fallback}\`；\`getStats\` 的
   totalConversations/totalTokens/totalMessages/thinkingLevels 与源码折叠一致；\`views\` 与 \`sessionView\` 一致；
   \`session/event\` live 增量折叠正确（+150 token、+1 会话、medium +1）。
3. **降级路径**：无 \`sessionPersistence\` 时 \`getStats\` 仍返回可用空快照（\`backfill.phase=ready\`）。
4. **projection 模式**：假 \`sessionProjections\`/\`sessionProjectionCache\`；注册单元
   \`key=dtsUsage, stateVersion=1\`；缓存命中 2 + 冷读 2；\`getStats\` 与源码折叠一致；单元
   \`init/apply/wire.view\` 与源码一致；\`stateSchema\`/\`viewSchema\` 接受真实状态/视图；
   \`onChanged\` 按会话替换视图（不累加）。
5. **兜底持久化**：\`schedulePersist\`+\`flushFallbackStore\` 在临时 \`DSH_HOME\` 写出
   \`storages/dsh-token-usage/session-rollup.v1.json\`，版本/会话视图/revision 正确。
6. **typert**：\`lib/typert.host.js\` 的 \`TYPERT\` 含 \`dsh-token-usage#tokenUsage/getStats\`；zod schema
   接受真实快照且解析后保留 \`backfill\`；删除 \`backfill\` 会被拒绝 → 进度字段已进入 wire 契约。
7. **client**：假 \`window.__ModuleLoader__\` 捕获 factory、假 react 执行后
   \`exports.apply\`(function) / \`exports.inject\`(\`['slots','connection']\`) 存在；
   \`apply(fake ctx)\` 不抛错，向 \`shell.overlay\`、\`sidebar.footer.action\`、
   \`conversation.session.header.actions\` 注册 3 个入口。

## 6. 复现

\`\`\`bash
# 全量对拍（--limit 0；去掉 --json 打印明细）
node --max-old-space-size=6144 scripts/verify/compare.mjs --limit 0 --json

# 旧发布构建 oracle（参考实现保真）
git show HEAD:lib/types/index.js > scripts/verify/out/old-lib-build.mjs
node scripts/verify/old-build-oracle.mjs 20

# 最新全量快照
node --max-old-space-size=6144 scripts/verify/snapshot.mjs

# 加载冒烟（37 项）
node scripts/verify/smoke.mjs
\`\`\`

产物：\`scripts/verify/out/full-report2.json\`（对拍明细）、\`snapshot-final.log\` / \`snapshot-full.json\`、
\`diff-session.json\`（差异会话剖析）。

## 7. 注意与建议

1. **语料活增长**：每次跑数字会小幅漂移（本次 907→910），只有"同一轮 old/new 对比"才有意义。
2. **构建时效**：冒烟针对上表哈希；任何 \`src/\` 改动后必须重建 \`lib/\` 并重跑
   \`node scripts/verify/smoke.mjs\`（若 \`src/aggregate.ts\` 改动还需重跑全量对拍）。
3. **桩冒烟不能替代真机**：验证的是"可导入 + 契约 + 数字口径"；仍建议在真实 DSH 里安装 0.3.0 打开一次面板
   （投影缓存读写、RPC 通道、slot 渲染只有真机才能覆盖）。
4. **语义变更记录**：attempt 内嵌 usage 计入、retry 复位是相对旧实现的主动变更；本语料未产生数字差，
   但应在 CHANGELOG/README 说明，避免未来 provider 行为变化时被当成 bug。
