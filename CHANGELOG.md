# Changelog

## [0.1.0] - 2026-08-15

### Added

- Token 用量统计面板（Session Gallery / Codex 个人用量页风格）：
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
