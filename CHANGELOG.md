# Changelog

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

### Changed

- 安装方式改为 DSH 0.2.x 的原生 bundle 安装（见 README「安装」），不再需要把
  源码拷进 DSH 仓库的 `packages/extensions/`。

### Verified

- `dsh --profile web --dump-config` 组合出的加载树含 `- id: token-usage / name: dsh-token-usage`。
- 客户端 bundle 仅 `require('react')`（DSH 平台模块表基线），并导出 `inject` + `apply`。
- Host 半边仅依赖 `@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-typert-protocol`，两者在 0.2.1 仍在。

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
