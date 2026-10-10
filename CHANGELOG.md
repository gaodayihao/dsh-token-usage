# Changelog

## [0.2.1] - 2026-10-09

**同时兼容桌面版与源码编译版 DSH**：安装时不再被 DSH 的 peer 兼容性闸门拦下。

### Fixed

- **peerDependencies 收宽到 `>=0.2.0-0 <0.3.0`**（`@deepseek-ai/cordis` 为 `>=4.0.4`）。
  0.2.0 声明的是 `^0.2.1-alpha.1`，在桌面版 DSH `0.2.0-rc.2` 上会被
  `installation rejected: ... is incompatible with dsh 0.2.0-rc.2` 整单拒绝并回滚。
  根因是 semver 语义：`0.2.0-rc.2 < 0.2.1-alpha.1`，「0.2.1 的预发布」并不覆盖
  「0.2.0 的预发布」，所以下界必须写成 `0.2.0-0` 这种显式预发布形式，才能同时
  匹配 `0.2.0-rc.1/rc.2` 与 `0.2.1-alpha.1/alpha.2`。cordis 同理取 `>=4.0.4`
  （桌面版内置 4.0.4，源码版 4.0.5-alpha.1）。
- **桌面版运行时 API 已逐项核对**，无需额外适配即可运行：`shell.overlay`、
  `sidebar.footer.action`、`conversation.session.header.actions` 三个槽位、
  `TypertRemoteService` / `@Remote`、`connection.rpc.call('/api', ...)`、
  `sessionPersistence.list()` 与 `open(id, 'access')`、以及 `package.json` 里的
  `dsh.bundle.patch` / `dsh.client.{platform,immediately,inject}` 声明，均在
  0.2.0-rc.2 中存在。

### Documentation

- README（中/英）安装一节改为「**0.2.0-rc.2 或 0.2.1 系列**」，并说明**不需要**
  `dsh plugin allow-version` 豁免。
- 新增排障小节：`installation rejected: ... is incompatible with dsh <版本>` 的
  处理顺序（先升级插件 → 核对 `dsh --version` → 万不得已才用精确版本豁免，并说明
  豁免只对「精确插件版本 + 精确 DSH 版本」生效、升级即失效、记录在 profile 的
  `compatibility.json`）。
- 新增说明：本仓库已提交 `lib/` 且无 `prepare` 脚本，因此 pnpm 不会挂起构建、不需要
  往 `pnpm-workspace.yaml` 加 `allowBuilds`；安装日志里那句 `allowBuilds` 提示的实际
  触发条件是「`pnpm add` 退出码非 0 **且** 安装规格形如 git 地址」——兼容性拒绝等任何
  失败都会带上它，它是通用提示、不是「构建真的被挂起」的证据（真正的挂起是安装失败
  类型 `build-blocked` + `pendingBuilds`，由插件管理器单独上报）。

## [Unreleased]

### Changed

- **安装文档改为「GitHub 直装」优先**：主推
  `dsh plugin --profile web add github:gaodayihao/dsh-token-usage`，不再要求先 clone 到本地；
  `file:` 本地目录安装降级为「改插件代码时用」的方式，并补充 Web 界面
  「插件 → 添加插件」直填 `github:` 规格的路径。
- **修正文档里的仓库地址**：原 README 指向上游 `jiamuAi/dsh-token-usage`，其 main 仍是 0.1.0，
  在 DSH 0.2.1 上会因 TYPERT manifest / client bundle 包名错误而加载失败（上游 issue #1）；
  改指本 fork（含 0.2.1 兼容修复），并在 README 中注明 fork 关系与回归上游的条件。
- **说明为什么本仓库可以直接从 Git 安装**：`lib/` 已提交、且没有 `prepare` / `postinstall`
  脚本，pnpm 不会挂起构建等 `allowBuilds` 审批；同时补充「不要添加 prepare 脚本」的维护者发布清单、
  锁版本（`#v0.2.0` / commit）与 `dsh plugin update` 升级方式。
- `README.en.md` 的安装一节此前还是 0.1.x 的「拷进 DSH 仓库 + build:lib」老流程，已整体重写为
  与中文版一致；并补上 `link:` 陷阱与升级说明。

## [0.2.0] - 2026-10-08

适配 DSH 0.2.1（`0.2.1-alpha.1`），插件在 DSH 升级后不再加载的问题已修复。

### Fixed

- **移除运行时 invariants 配套插件**：DSH v0.2.0-rc.2 起不再发布
  `@deepseek-ai/dsh-invariants`、`InvariantRegistry` 和任何 `<包>/invariant`
  子路径（见 DSH 升级指南 `remove-runtime-invariants`）。相应地删除
  `src/invariant.ts`、`lib/types/invariant.*`，并从 `exports` 与
  `peerDependencies` 中去掉对应条目。已装 profile 中遗留的
  `dsh-token-usage/invariant` 行也应删除。
- **客户端半边改用通用 Client Context**：`@deepseek-ai/dsh-client-runtime`
  已不存在，客户端插件契约现在是 `import type { Context } from '@deepseek-ai/cordis'`
  加模块级 `export const inject` / `export function apply(ctx)`。
- **peerDependencies 改为显式版本范围**：原先的 `workspace:^` 只适用于 DSH
  仓库内部，装到 profile 里会解析失败/被兼容性闸门拦下；现按官方插件写法声明
  `^0.2.1-alpha.1`（`@deepseek-ai/cordis` 为 `~4.0.5-alpha.1`）。
- 补充 `engines.node >= 20`。
- **安装方式必须是 `file:` / `github:`，不能是 `link:` 或裸路径**：裸绝对路径会被
  pnpm 记成 `link:`，而 `link:` 不安装依赖，插件目录不在 profile 的 `node_modules`
  之下，`lib/typert.host.js` 的 `import 'zod'` 永远解析不到。typert-loader 只要
  有一个 contributor 注册失败就中止整轮注册，导致所有 Remote 端点丢掉 strict
  定义、Web 界面整体失效（工作区列表空白、目录选择器报
  `its strict definition was withdrawn and SRC fallback is forbidden`）。数据无损，
  移除依赖重启即恢复。README「安装」一节已写明该陷阱与自检命令。

### Changed

- 安装方式改为 DSH 0.2.x 的原生 bundle 安装（见 README「安装」），不再需要把
  源码拷进 DSH 仓库的 `packages/extensions/`。

### Verified

- `dsh --profile web --dump-config` 组合出的加载树含 `- id: token-usage / name: dsh-token-usage`。
- 客户端 bundle 仅 `require('react')`（DSH 平台模块表基线），并导出 `inject` + `apply`。
- Host 半边仅依赖 `@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-typert-protocol`，两者在 0.2.1 仍在。
- 用 `file:` 装进 profile 后，直接 `import()` 安装副本的 `lib/typert.host.js` 成功
  打印 `TYPERT { package: 'dsh-token-usage', face: 'host', invocations: ['dsh-token-usage#tokenUsage/getStats'] }`
  —— 这正是此前失败的那一步（zod 解析）。

## [0.1.0] - 2026-08-15

### Added

- Token 用量统计面板（Codex 个人用量页风格）：
  - 用户区：头像（emoji / 本地图片，localStorage 持久化）+ 可编辑昵称 + 数据范围副标题
  - 5 指标栏：累计 / 单会话峰值 Token、最长聊天时长、当前 / 最长连续天数
  - Token 活动热力图：每日（GitHub 贡献图）/ 每周（柱状）/ 累计（SVG 折线）三视图
  - 活动洞察（含最常用模型）+ 插件 / Skill Top5（类型标注）
  - 深空紫渐变双主题（跟随系统 / 手动切换）
- 入口：
  - 侧边栏底部「Token 统计」按钮（与设置对齐，应用级常驻）
  - 会话头部实时用量胶囊（`⚡ 2.61亿`，随轮询刷新）
- 数据口径与 DSH 内置 token-meter 一致：`assistant/chunk {type:'usage'}` 持久记录 +
  `assistant/message.usage` 覆盖去重；累计 = input + output + cacheRead + cacheWrite。
- Host 半边：`TokenUsageService`（Typert Remote `tokenUsage/getStats`），历史回填 +
  `session/event` 实时折叠；浏览器半边通过通用 RPC 通道取数，独立安装无需改动 DSH 源码。
