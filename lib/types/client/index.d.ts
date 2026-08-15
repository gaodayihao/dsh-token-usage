/**
 * Token 统计面板 — 浏览器半边（Session Gallery 风格）
 *
 * 以 OpenClaw Session Gallery 统计面板为样本，逻辑与视觉均为 DSH 原生实现：
 *  - 用户区：头像（emoji 或本地图片，localStorage 持久化）+ 可编辑昵称 + 数据范围副标题
 *  - 5 指标栏：累计 / 峰值 Token、最长聊天时长、当前 / 最长连续天数
 *  - Token 活动热力图：每日（GitHub 贡献图）/ 每周（柱状）/ 累计（SVG 折线）
 *  - 底部两栏：活动洞察 + 最常用插件 / Skill Top5（标注类型）
 *  - 深空紫渐变双主题，右上角切换；Escape / 外部点击统一关闭
 *
 * Formal client plugin contract: module exports `inject` + `apply(ctx)`; the
 * loader mounts it into the page's cordis tree and the browser half registers
 * the `shell.overlay` slot. Data comes from the host half via the generic RPC
 * channel (`connection.rpc.call('/api', 'tokenUsage/getStats')`).
 * @module @deepseek-ai/dsh-token-usage
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Required services: slot registry + the generic RPC channel. */
export declare const inject: string[];
/**
 * Mount the panel: inject styles, poll the host snapshot, register the
 * `shell.overlay` modal plus the two entry points (sidebar footer + session
 * header capsule).
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map