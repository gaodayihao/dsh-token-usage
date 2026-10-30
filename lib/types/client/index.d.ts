/**
 * Token 统计面板 — 浏览器半边类型声明（实现见 lib/client.js）。
 * @module @deepseek-ai/dsh-token-usage/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
/** Required services: slot registry + the generic RPC channel. */
export declare const inject: string[];
/**
 * Mount the panel: inject styles, poll the host snapshot, register the
 * `shell.overlay` modal plus the two entry points (sidebar footer + session
 * header capsule).
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
