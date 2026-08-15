# dsh-token-usage

> **DSH 的 Token 用量统计面板** —— 仿 Codex 个人用量页 / OpenClaw Session Gallery 风格。
> A token-usage stats panel for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): whole-instance token consumption, activity heatmap, plugin/skill leaderboards — Codex usage-page style.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![DSH](https://img.shields.io/badge/DSH-web--profile-8b7cf6)
![Status](https://img.shields.io/badge/status-beta-yellow)

---

## 这是什么

DSH 刚发布，大家最关心的是：**我的 Token 到底烧哪去了？**

这个插件在 DSH Web 界面里加一个**Token 用量统计面板**，把当前运行实例**全部会话**的 token 消耗汇总成 Codex 个人用量页那种一目了然的样子，点击入口即弹出居中面板：

![面板（每日视图）](./docs/screenshot-panel.png)
![面板（累计视图）](./docs/screenshot-panel-cumulative.png)

## 特性

- **5 大指标**：累计 / 峰值 Token、最长聊天时长、当前 / 最长连续天数
- **Token 活动热力图**：每日（GitHub 贡献图）/ 每周（柱状）/ 累计（SVG 折线）三视图，悬浮看数值
- **活动洞察**：推理强度分布、Skill 使用、消息/工具统计
- **插件 / Skill Top5**：谁在消耗最多，一目了然
- **两个原生入口**（与 DSH UI 融为一体）：
  - 侧边栏底部「Token 统计」按钮（与设置对齐，应用级常驻）
  - 会话头部实时用量胶囊：`⚡ 2.15亿`（每 5 秒自动刷新数字）
- **深空紫双主题**：跟随系统 / 手动切换；浅色深色都好看
- **零 DSH 源码改动**：浏览器半边走通用 RPC 通道，安装即用

![入口：侧栏底部按钮 + 会话头部 ⚡ 胶囊](./docs/screenshot-entries.png)

## 为什么值得装

- **看得见**：累计、峰值、每日热力图，一眼知道 token 花在哪
- **够直观**：Codex 用户秒懂，零学习成本
- **有传播性**：截一张面板图发出去，DSH 生态第一波插件

## 安装

装完记得重启 `dsh web` 并刷新页面。

### 一句话安装（推荐）：让 Agent 自己装

把下面这句话发给你的 DSH Agent（替换 `<仓库路径>` 为克隆下来的路径）：

> 把 dsh-token-usage 插件（源码在 `<仓库路径>`）安装为 DSH 正式插件：构建 lib、把包挂进 web profile 的 dsh.profile.bundles、重启 dsh web，然后验证面板出现。

Agent 会读取本 README 完成构建、挂载与重启。

### 手动方式 A：放进 DSH 仓库（最顺）

```sh
git clone https://github.com/deepseek-ai/deepseek-harness && cd deepseek-harness && pnpm install
git clone <本仓库地址> && cp -R dsh-token-usage packages/extensions/
pnpm install && pnpm run build:lib
# ~/.dsh/profiles/web/package.json: dependencies 加 "dsh-token-usage": "workspace:^"
#                              dsh.profile.bundles 加 "dsh-token-usage"
```

### 手动方式 B：独立目录 + profile 链接（不动 DSH 源码）

```sh
git clone <本仓库地址>
cd ~/.dsh/profiles/web && pnpm add file:<克隆路径>
# dsh.profile.bundles 加 "dsh-token-usage"
```

> 插件运行所需的 `@deepseek-ai/*` 依赖由 DSH 安装提供（peerDependencies），无需单独安装。

## 使用

1. 重启 `dsh web` 后，**左侧栏底部**出现「Token 统计」入口
2. 打开任意会话，**标题旁**出现实时用量胶囊 `⚡ 2.15亿`
3. 点击任一入口打开居中面板；右上角可切主题、关闭
4. 面板内热力图支持三视图切换 + 悬浮看单日/单周/累计数值

数据每 5 秒刷新；历史会话在插件加载时自动回填，重启不丢。

## 数据口径

与 DSH 内置 token-meter 一致：

- 每 step 一条 usage 记录：`assistant/chunk {type:'usage'}` 为持久记录；`assistant/message.usage` 覆盖同一步的 chunk 记录（**不重复计数**）
- 累计 Token = input + output + cacheRead + cacheWrite
- thinking 等级由 `reasoningTokens` 近似（DSH 无显式等级）
- Skill 统计从 `skill` 工具调用参数解析；「插件」= 非 DSH 核心工具集

## 架构

```
┌─ Host（DSH 进程内）──────────────────────────────┐
│ TokenStatsService (TypertRemoteService)          │
│  ├─ 启动时 sessionPersistence.list()/inspect()   │  ← 历史回填
│  ├─ session/event 实时折叠                        │  ← 实时累计
│  └─ @Remote('getStats') → /api/tokenStats/getStats│
└──────────────┬───────────────────────────────────┘
               │ connection.rpc（通用通道，无需改 DSH）
┌─ Browser ────▼───────────────────────────────────┐
│ client/index.ts                                  │
│  ├─ sidebar.footer.action  侧栏入口              │
│  ├─ conversation.session.header.actions ⚡ 胶囊   │
│  └─ shell.overlay           面板模态框           │
└──────────────────────────────────────────────────┘
```

关键文件：

| 文件 | 作用 |
|---|---|
| `src/index.ts` | Host 半边：聚合逻辑 + Typert Remote |
| `src/client/index.ts` | 浏览器半边：面板 UI + 两个入口 + 5s 轮询 |
| `src/types.ts` | 跨平面 wire 类型（`TokenStatsSnapshot`） |
| `src/invariant.ts` | 包级 invariant 伴生 |
| `cordis.patch.yml` | bundle patch：插入 `token-usage` 插件行 |
| `lib/` | **已提交的构建产物**（装了就能跑，无需构建） |

## 开发

构建链路依赖 DSH 仓库的编译工具（tsc 项目引用 + tsdown + Typert 生成器），因此开发需在 DSH checkout 内进行（方式 A 的目录结构）：

```sh
# 浏览器半边改动后（注意：必须先 tsc 再 tsdown）
pnpm exec tsc -b packages/extensions/dsh-token-stats/tsconfig.client.json
pnpm exec tsdown --env.DSH_BUILD_FACE client
# host 半边改动后
pnpm exec tsc -b packages/extensions/dsh-token-stats/tsconfig.host.json
pnpm run build:lib:host
# 然后重启 dsh web
```

提交前记得 `pnpm run build:lib` 并提交 `lib/`，让使用者免构建。

## FAQ

- **为什么数字和 DSH 内置显示不完全一样？** 口径一致（token-meter 折叠规则），但本面板按 step 去重计数，失败请求的 usage 也会计入。
- **重启会丢数据吗？** 不会。面板从持久化 session 日志重新回填。
- **头像/昵称能同步到别的设备吗？** 当前存在浏览器 localStorage；后续可用 DSH storage 服务升级。
- **能只看某个会话吗？** 当前是实例级汇总；按会话视图在规划中。

## License

[MIT](./LICENSE)

---

Made for the DSH community · 欢迎 Star / Issue / PR
