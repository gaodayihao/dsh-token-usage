# dsh-token-usage

**中文** · [English](./README.en.md)

**DSH 的 Token 用量统计面板** —— 仿 Codex 个人用量页风格，把整个 DSH 实例的 Token 消耗一目了然地展示出来：累计 / 单会话峰值、活动热力图、插件 Top5。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-8b7cf6)
![Status](https://img.shields.io/badge/status-beta-yellow)

## 这是什么

DSH 刚发布，大家最关心的就是：**我的 Token 到底花哪去了？**

这个插件在 DSH Web 界面里加一个 Token 用量统计面板，把当前运行实例**全部会话**的 token 消耗汇总，点击入口即弹出居中面板（深色 / 浅色主题）：

![面板（浅色主题）](./docs/screenshot-panel-light.png)
![面板（深色主题）](./docs/screenshot-panel-dark.png)

## 特性

- **5 大指标**：累计 / 单会话峰值 Token、最长聊天时长、当前 / 最长连续天数
- **Token 活动热力图**：每日（GitHub 贡献图）/ 每周（柱状）/ 累计（折线）三视图，悬浮看数值
- **活动洞察（含最常用模型）+ 插件 / Skill Top5**：谁在消耗最多，一目了然
- **两个原生入口**，与 DSH UI 融为一体：
  - 侧边栏底部「Token 统计」按钮（应用级常驻）
  - 会话头部实时用量胶囊：`⚡ 2.61亿`（每 5 秒自动刷新）
- **深空紫双主题**，跟随系统 / 手动切换

![入口位置：侧边栏底部按钮 + 会话头部 ⚡ 胶囊](./docs/screenshot-entries.png)

## 为什么值得装

- **一眼看清 Token 去向**：累计、单会话峰值、每日热力图，不用再猜
- **Codex 用户零学习成本**：熟悉的用量页风格，界面一看就懂
- **天然的传播素材**：大家都喜欢晒"我今天用了多少 token"，截一张图发出去，就是最好的宣传

## 安装

需要 DSH **0.2.1 及以上**。插件依赖 DSH 内置包（`@deepseek-ai/*`），运行时由 DSH 自己解析，无需额外构建。

### 方式一：让 Agent 一句话装好（推荐）

把下面这句话发给你的 DSH Agent，它会自己读这个仓库的说明并完成安装：

> 你看一下这个仓库：https://github.com/jiamuAi/dsh-token-usage ，然后帮我把 dsh-token-usage 安装到我的 DSH 上。

### 方式二：命令行装

```sh
git clone https://github.com/jiamuAi/dsh-token-usage.git
dsh plugin --profile web add "file:$(pwd)/dsh-token-usage"
```

`dsh plugin` 走的是 DSH 0.2.x 的原生 bundle 安装：把它写进 `~/.dsh/profiles/web/package.json`
的 `dependencies` 和 `dsh.profile.bundles`，并自动应用包内的 `cordis.patch.yml`，
把插件行插进加载树。装到别处就换 `--profile` 的名字（如 `tui`）。

最后重启 `dsh web`，刷新页面即可看到入口。

> 仓库里若有已推送的 0.2.0 版本，也可以直接 `dsh plugin --profile web add github:jiamuAi/dsh-token-usage`。

### ⚠️ 必须用 `file:` 或 `github:`，不要用 `link:` 或裸路径

`dsh plugin --profile web add <绝对路径>`（不加 `file:` 前缀）会被 pnpm 记成
`link:`，而 **`link:` 不会安装该包的依赖**。本插件生成的 `lib/typert.host.js`
里有 `import { z } from 'zod'`，`link:` 之后插件目录不在 profile 的 `node_modules`
之下，zod 永远解析不到，于是：

```
typert-loader: dsh-token-usage exports "./typert" but importing ... failed:
  Cannot find package '.../node_modules/zod/index.js'
```

而 typert-loader 只要有一个 contributor 注册失败，**整轮注册都会中止** ——
后果不是插件单独失效，而是所有 Remote 端点都失去 strict 定义，DSH 界面会整体崩掉
（工作区列表空白、目录选择器报
`directoryPicker/pick: its strict definition was withdrawn and SRC fallback is forbidden`）。
数据不会丢，`~/.dsh/storages/workspace.json` 和会话日志都还在，移除该依赖重启即可恢复。

要确认装对了，可以在装完后跑一次（把路径换成 profile 里的安装副本）：

```sh
node -e "import('file:///C:/Users/<你>/.dsh/profiles/web/node_modules/dsh-token-usage/lib/typert.host.js').then(m => console.log(m.TYPERT))"
```

打印出 `TYPERT` 对象就算通过；报 zod 找不到就是装成了 `link:`，卸掉重装。

### 从 0.1.x 升级

1. 若 `~/.dsh/profiles/web/package.json` 里已有一条旧的 `dsh-token-usage` 依赖，
   先 `dsh plugin --profile web remove dsh-token-usage`，再按上面重新安装
   （注意用 `file:` 前缀，见下面的警告）。
2. 若 profile 配置（`cordis.yml` / `cordis.patch.yml` / `--patch`）里有 `name` 为
   `@deepseek-ai/dsh-invariants` 或以 `/invariant` 结尾的行，请删掉 —— DSH
   v0.2.0-rc.2 起不再发布 `invariants` 服务与任何 `<包>/invariant` 子路径。
3. 重启 `dsh web` 并刷新页面。

> **0.1.x 的老装法已废弃**：以前是把源码拷进 `<deepseek-harness>/packages/extensions/`
> 再跑 `pnpm run build:lib`。DSH 更新会覆盖仓库目录，拷进去的文件随之丢失，插件于是"失效"。
> 请改用上面的 profile 安装方式，它写在 `~/.dsh/profiles/` 下，不受 DSH 更新影响。

## 使用

1. 重启后，**左侧栏底部**出现「Token 统计」入口
2. 打开任意会话，**标题旁**出现实时用量胶囊 `⚡ 2.61亿`
3. 点击任一入口打开面板；右上角可切主题、关闭
4. 热力图支持三视图切换 + 悬浮看单日 / 单周 / 累计数值

数据每 5 秒刷新；历史会话自动回填，重启不丢。

## 数据口径

与 DSH 内置 token-meter 一致：

- 每 step 一条 usage 记录：`assistant/chunk {type:'usage'}` 为持久记录；`assistant/message.usage` 覆盖同一步的 chunk 记录（不重复计数）
- 累计 Token = input + output + cacheRead + cacheWrite
- thinking 等级由 `reasoningTokens` 近似；Skill 统计从 `skill` 工具调用参数解析

## 架构

```
┌─ Host（DSH 进程内）──────────────────────────────┐
│ TokenUsageService (TypertRemoteService)          │
│  ├─ 启动时回填全部历史 session                    │
│  ├─ session/event 实时折叠                        │
│  └─ @Remote('getStats') → /api/tokenUsage/getStats│
└──────────────┬───────────────────────────────────┘
               │ connection.rpc（通用通道，无需改 DSH）
┌─ Browser ────▼───────────────────────────────────┐
│  ├─ sidebar.footer.action        侧栏入口        │
│  ├─ conversation.session.header.actions ⚡ 胶囊   │
│  └─ shell.overlay                面板模态框       │
└──────────────────────────────────────────────────┘
```

| 文件 | 作用 |
|---|---|
| `src/index.ts` | Host 半边：聚合逻辑 + Typert Remote |
| `src/client/index.ts` | 浏览器半边：面板 UI + 两个入口 + 5s 轮询 |
| `src/types.ts` | 跨平面 wire 类型 |
| `cordis.patch.yml` | bundle patch：插入插件行 |
| `lib/` | 已提交的构建产物（装了就能跑，无需构建） |

## 开发

`lib/` 里是现成构建产物，**一般使用者无需构建**。要改代码的话，构建链路依赖 DSH 仓库的编译工具（tsc + tsdown + Typert 生成器），把 `src/` 放进 DSH 仓库的 `packages/extensions/dsh-token-usage/` 下构建，构建产物 `lib/` 同步回本仓库提交即可。

## License

[MIT](./LICENSE)

---

Made for the DSH community · 欢迎 Star / Issue / PR
