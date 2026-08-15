window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-token-stats",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region lib/types/client/index.js
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
		* the `shell.overlay` slot. Data comes from the host half's Typert Remote
		* namespace (`ctx.remote.tokenStats.getStats()`).
		* @module @deepseek-ai/dsh-token-stats
		*/
		let latest = null;
		let lastError = null;
		const listeners = /* @__PURE__ */ new Set();
		function subscribe(fn) {
			listeners.add(fn);
			return () => {
				listeners.delete(fn);
			};
		}
		function getSnapshot() {
			return latest;
		}
		function getError() {
			return lastError;
		}
		function notify() {
			for (const fn of [...listeners]) fn();
		}
		let panelOpen = false;
		const openListeners = /* @__PURE__ */ new Set();
		function subscribeOpen(fn) {
			openListeners.add(fn);
			return () => {
				openListeners.delete(fn);
			};
		}
		function getOpen() {
			return panelOpen;
		}
		function setOpen(v) {
			panelOpen = v;
			for (const fn of [...openListeners]) fn();
		}
		const h = react.createElement;
		function fmtInt(n) {
			return (n ?? 0).toLocaleString("en-US");
		}
		function fmtYi(n) {
			return ((n ?? 0) / 1e8).toFixed(2);
		}
		function fmtTok(n) {
			n = n || 0;
			return n >= 1e8 ? `${(n / 1e8).toFixed(2)}亿` : n >= 1e4 ? `${(n / 1e4).toFixed(1)}万` : String(n);
		}
		function dayKeyOf(d) {
			return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
		}
		function hmLevelsOf(daily) {
			const vals = Object.values(daily || {}).filter((v) => v > 0).sort((a, b) => a - b);
			const lv = [];
			if (vals.length) for (let i = 1; i <= 6; i++) {
				const idx = Math.min(vals.length - 1, Math.round((vals.length - 1) * i / 6));
				lv.push(vals[idx]);
			}
			return lv;
		}
		function levelOf(v, levels) {
			if (v <= 0) return 0;
			let l = 0;
			for (let i = 0; i < 6; i++) if (v >= (levels[i] ?? 0)) l = i + 1;
			return l;
		}
		const ICON_PATHS = {
			close: "M18 6 6 18M6 6l12 12",
			sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42",
			moon: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z",
			pencil: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z",
			camera: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z",
			upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
			image: "M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6",
			sparkles: "M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z",
			trash: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
		};
		function Icon({ name, size = 16 }) {
			const paths = (ICON_PATHS[name] || "").split("M").filter(Boolean).map((p) => "M" + p);
			return h("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 2,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": true
			}, paths.map((d) => h("path", {
				d,
				key: d
			})));
		}
		const TOOL_ICONS = {
			edit: "✏️",
			read: "📖",
			write: "📝",
			bash: "💻",
			glob: "🔍",
			grep: "🔍",
			subagent: "👥",
			web_search: "🌐",
			web_fetch: "🕸️",
			session_search: "📋",
			session_event_search: "🧠",
			session_trace: "🗺️",
			schedule_create: "⏰",
			skill: "🧩",
			workflow: "🔀",
			ralph: "♻️",
			mcp__reference_memory__read_graph: "📂",
			mcp__reference_memory__create_entities: "🆕"
		};
		const TOOL_COLORS = [
			"#8b7cf6",
			"#f59e0b",
			"#10b981",
			"#3b82f6",
			"#ef4444",
			"#ec4899",
			"#14b8a6",
			"#6366f1"
		];
		function hashIdx(n) {
			let hsh = 0;
			for (const c of String(n)) hsh = hsh * 31 + c.charCodeAt(0) >>> 0;
			return hsh % TOOL_COLORS.length;
		}
		function shortName(name) {
			return String(name).includes("__") ? String(name).split("__").pop() : String(name);
		}
		function loadProfile() {
			try {
				const raw = localStorage.getItem("dts-profile");
				if (raw) {
					const p = JSON.parse(raw);
					if (p && typeof p === "object") return {
						avatar: p.avatar || "🧑‍💻",
						kind: p.kind === "image" ? "image" : "emoji",
						name: p.name || "DSH"
					};
				}
			} catch {}
			return {
				avatar: "🧑‍💻",
				kind: "emoji",
				name: "DSH"
			};
		}
		function saveProfile(profile) {
			try {
				localStorage.setItem("dts-profile", JSON.stringify(profile));
			} catch {}
		}
		const AVATAR_CHOICES = [
			"🧑‍💻",
			"🤖",
			"🧙",
			"🦊",
			"🐼",
			"🚀",
			"⚡",
			"🔥",
			"🌟",
			"🐳"
		];
		const PANEL_CSS = `
.dts-root { font-size: 14px; line-height: 1.55; -webkit-font-smoothing: antialiased; }
.dts-root[data-theme="dark"] {
  --bg-app: #0e0d16; --bg-inset: #171624; --bg-elevated: #1c1b2c; --bg-elevated-2: #242238;
  --text: #edeaf7; --text-dim: #a5a1c4; --text-faint: #6f6b8f;
  --border: rgba(139,124,246,0.14); --border-strong: rgba(139,124,246,0.30);
  --accent: #8b7cf6; --accent-2: #6e8bff; --accent-soft: rgba(139,124,246,0.14);
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
  background:
    radial-gradient(1200px 600px at 85% -10%, rgba(139,124,246,0.10), transparent 60%),
    radial-gradient(900px 500px at -10% 110%, rgba(110,139,255,0.08), transparent 55%),
    var(--bg-app);
}
.dts-root[data-theme="light"] {
  --bg-app: #f6f5fb; --bg-inset: #eceaf5; --bg-elevated: #ffffff; --bg-elevated-2: #e6e3f2;
  --text: #2b2938; --text-dim: #6f6b85; --text-faint: #a09bb8;
  --border: rgba(90,80,180,0.12); --border-strong: rgba(90,80,180,0.24);
  --accent: #6d5ce8; --accent-2: #4a7dff; --accent-soft: rgba(109,92,232,0.10);
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
  background:
    radial-gradient(1200px 600px at 85% -10%, rgba(109,92,232,0.08), transparent 60%),
    radial-gradient(900px 500px at -10% 110%, rgba(74,125,255,0.06), transparent 55%),
    var(--bg-app);
}
.dts-panel { position: fixed; inset: 0; background: rgba(15,14,26,0.55); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); z-index: 9998; display: flex; align-items: center; justify-content: center; padding: 24px; }
.dts-panel-content { position: relative; background: var(--bg-app); border: 1px solid var(--border-strong); border-radius: 22px; max-width: 840px; width: 100%; box-shadow: 0 24px 70px rgba(0,0,0,0.45); max-height: 96vh; overflow-y: auto; padding: 28px 30px 24px; color: var(--text); }
.dts-loading-badge {
  display: inline-flex; align-items: center; gap: 5px;
  margin-left: 8px; padding: 1px 8px; border-radius: 20px;
  background: var(--accent-soft); color: var(--accent);
  font-size: 10.5px; font-weight: 600; letter-spacing: 0.02em;
  vertical-align: middle;
}
.dts-loading-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; animation: dts-pulse 1.2s var(--ease) infinite; flex-shrink: 0; }
@keyframes dts-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(0.8); } }
.dts-stale-note { font-size: 12px; color: var(--text-faint); background: var(--bg-inset); border: 1px solid var(--border); border-radius: 9px; padding: 6px 12px; margin-bottom: 14px; word-break: break-all; }
.dts-entry-scope { display: contents; }
.dts-top-actions { position: absolute; top: 14px; right: 14px; display: flex; gap: 6px; }
.dts-sidebar-entry {
  display: flex; align-items: center; gap: 8px;
  flex: none;
  width: calc(100% + 8px);
  height: 34px;
  margin: 4px -4px 4px;
  padding: 6px 2px 6px 10px;
  border: none; background: transparent;
  color: var(--text-dim); border-radius: 8px; cursor: pointer;
  font-size: 13px; transition: all 0.15s var(--ease);
  box-sizing: border-box;
}
.dts-sidebar-entry:hover { background: var(--accent-soft); color: var(--text); }
.dts-sidebar-entry svg { color: var(--accent); flex-shrink: 0; }
.dts-sidebar-entry.rail { justify-content: center; width: 36px; height: 36px; padding: 0; margin: 8px 0 10px; }
.dts-header-capsule {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 20px; border: 1px solid var(--border);
  background: var(--bg-inset); color: var(--text-dim); font-size: 12px;
  cursor: pointer; white-space: nowrap; transition: all 0.15s var(--ease);
  vertical-align: middle;
}
.dts-header-capsule:hover { border-color: var(--accent); color: var(--text); background: var(--bg-elevated); }
.dts-header-capsule.active { border-color: var(--accent); color: var(--text); }
.dts-header-capsule svg { color: var(--accent); flex-shrink: 0; }
.dts-header-total { font-variant-numeric: tabular-nums; font-weight: 600; }
.dts-icon-btn {
  width: 32px; height: 32px; border-radius: 50%;
  border: 1px solid var(--border); background: var(--bg-inset);
  color: var(--text-dim); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.18s var(--ease);
}
.dts-icon-btn:hover { background: var(--bg-elevated-2); color: var(--text); border-color: var(--border-strong); transform: scale(1.06); }
.dts-user { display: flex; flex-direction: column; align-items: center; margin-bottom: 18px; }
.dts-avatar-wrap { position: relative; }
.dts-avatar-ring {
  width: 72px; height: 72px; border-radius: 50%; padding: 3px; cursor: pointer;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  box-shadow: 0 6px 20px rgba(110,90,240,0.30);
  transition: transform 0.2s var(--ease), box-shadow 0.2s var(--ease);
  position: relative;
}
.dts-avatar-ring:hover { transform: scale(1.04); box-shadow: 0 8px 26px rgba(110,90,240,0.42); }
.dts-avatar { width: 100%; height: 100%; border-radius: 50%; overflow: hidden; background: var(--bg-elevated-2); display: flex; align-items: center; justify-content: center; font-size: 32px; }
.dts-avatar-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dts-avatar-emoji { line-height: 1; }
.dts-avatar-hover {
  position: absolute; inset: 3px; border-radius: 50%;
  background: rgba(10,10,20,0.45); color: #fff;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity 0.18s var(--ease);
}
.dts-avatar-ring:hover .dts-avatar-hover { opacity: 1; }
.dts-avatar-picker {
  position: absolute; top: calc(100% + 10px); left: 50%; transform: translateX(-50%);
  width: 240px; padding: 10px;
  background: var(--bg-elevated-2); border: 1px solid var(--border-strong); border-radius: 16px;
  box-shadow: 0 16px 40px rgba(0,0,0,0.35); z-index: 20;
}
.dts-picker-tabs { display: flex; gap: 2px; background: var(--bg-inset); border-radius: 9px; padding: 2px; margin-bottom: 10px; }
.dts-picker-tab { flex: 1; font-size: 12.5px; color: var(--text-faint); cursor: pointer; padding: 4px 0; border-radius: 7px; transition: all 0.15s var(--ease); border: none; background: transparent; }
.dts-picker-tab.active { color: var(--text); background: var(--bg-elevated-2); font-weight: 600; }
.dts-avatar-grid { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.dts-avatar-opt { width: 36px; height: 36px; border-radius: 10px; border: 1px solid transparent; background: transparent; cursor: pointer; font-size: 20px; display: flex; align-items: center; justify-content: center; transition: all 0.15s var(--ease); }
.dts-avatar-opt:hover { background: var(--bg-inset); transform: scale(1.08); }
.dts-avatar-opt.active { border-color: var(--accent); background: var(--accent-soft); }
.dts-avatar-upload { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 4px 0; }
.dts-upload-btn {
  display: flex; align-items: center; gap: 8px;
  border: 1px dashed var(--border-strong); background: var(--bg-inset);
  color: var(--text); border-radius: 10px; padding: 10px 16px; cursor: pointer;
  font-size: 13px; transition: all 0.18s var(--ease);
}
.dts-upload-btn:hover { border-color: var(--accent); background: var(--accent-soft); }
.dts-upload-clear {
  display: flex; align-items: center; gap: 6px;
  border: none; background: transparent; color: var(--text-faint); cursor: pointer;
  font-size: 12px; transition: color 0.15s var(--ease);
}
.dts-upload-clear:hover { color: var(--text); }
.dts-upload-hint { font-size: 11px; color: var(--text-faint); text-align: center; }
.dts-user-name { position: relative; display: inline-flex; align-items: center; font-size: 21px; font-weight: 700; color: var(--text); margin-top: 10px; letter-spacing: 0.01em; cursor: pointer; }
.dts-user-name:hover { opacity: 0.85; }
.dts-name-edit-icon {
  position: absolute; left: calc(100% + 8px); top: 50%; transform: translateY(-50%);
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--bg-inset); border: 1px solid var(--border); color: var(--text-faint);
  opacity: 0; transition: opacity 0.18s var(--ease);
}
.dts-user-name:hover .dts-name-edit-icon { opacity: 1; }
.dts-user-sub { font-size: 13px; color: var(--text-faint); margin-top: 6px; letter-spacing: 0.01em; }
.dts-user-edit { margin-top: 12px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.dts-name-input { background: var(--bg-inset); border: 1px solid var(--border-strong); border-radius: 10px; color: var(--text); font-size: 15px; padding: 7px 14px; text-align: center; width: 200px; outline: none; transition: border-color 0.15s var(--ease); }
.dts-name-input:focus { border-color: var(--accent); }
.dts-edit-actions { display: flex; gap: 8px; }
.dts-edit-btn { border: 1px solid var(--border); background: transparent; color: var(--text-dim); border-radius: 9px; padding: 5px 16px; cursor: pointer; font-size: 12.5px; transition: all 0.15s var(--ease); }
.dts-edit-btn:hover { background: var(--bg-inset); color: var(--text); }
.dts-edit-btn.primary { background: linear-gradient(135deg, var(--accent), var(--accent-2)); border-color: transparent; color: #fff; }
.dts-edit-btn.primary:hover { opacity: 0.9; }
.dts-metrics { display: flex; border: 1px solid var(--border); border-radius: 14px; overflow: hidden; margin-bottom: 20px; background: var(--bg-elevated); box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
.dts-metric { flex: 1; padding: 14px 6px 12px; text-align: center; min-width: 0; }
.dts-metric + .dts-metric { border-left: 1px solid var(--border); }
.dts-metric .m-num { font-size: 19px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; white-space: nowrap; }
.dts-metric .m-num.accent { background: linear-gradient(135deg, var(--accent), var(--accent-2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.dts-metric .m-num .unit { font-size: 11px; font-weight: 500; color: var(--text-faint); margin-left: 2px; }
.dts-metric .m-label { font-size: 11px; color: var(--text-dim); margin-top: 4px; }
.dts-heatmap { margin-bottom: 20px; }
.hm-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.hm-title { font-size: 14px; font-weight: 700; color: var(--text); }
.hm-tabs { display: flex; gap: 2px; background: var(--bg-inset); border-radius: 9px; padding: 2px; }
.hm-tab { font-size: 12.5px; color: var(--text-faint); cursor: pointer; padding: 4px 12px; border-radius: 7px; transition: all 0.15s var(--ease); border: none; background: transparent; }
.hm-tab.active { color: var(--text); background: var(--bg-elevated-2); font-weight: 600; }
.hm-wrap { overflow-x: hidden; padding-bottom: 4px; }
.hm-months { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 2px; font-size: 10px; color: var(--text-faint); margin-bottom: 4px; height: 14px; width: 100%; }
.hm-months span { overflow: visible; white-space: nowrap; text-align: left; line-height: 14px; }
.hm-grid { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, auto); grid-auto-columns: 1fr; gap: 2px; width: 100%; }
.hm-cell { width: 100%; aspect-ratio: 1; border-radius: 3px; background: var(--bg-inset); }
.dts-root[data-theme="light"] .hm-cell.l1 { background: #dbe6f7; }
.dts-root[data-theme="light"] .hm-cell.l2 { background: #b6cbec; }
.dts-root[data-theme="light"] .hm-cell.l3 { background: #8fb0e0; }
.dts-root[data-theme="light"] .hm-cell.l4 { background: #6694d4; }
.dts-root[data-theme="light"] .hm-cell.l5 { background: #3f78c8; }
.dts-root[data-theme="light"] .hm-cell.l6 { background: #1e5cbc; }
.dts-root[data-theme="dark"] .hm-cell.l1 { background: #203a55; }
.dts-root[data-theme="dark"] .hm-cell.l2 { background: #1c4a6e; }
.dts-root[data-theme="dark"] .hm-cell.l3 { background: #185a88; }
.dts-root[data-theme="dark"] .hm-cell.l4 { background: #146ba2; }
.dts-root[data-theme="dark"] .hm-cell.l5 { background: #107cbc; }
.dts-root[data-theme="dark"] .hm-cell.l6 { background: #0c8ed6; }
.hm-cell:hover { outline: 2px solid var(--text-dim); outline-offset: 1px; }
.hm-bars { display: flex; align-items: flex-end; gap: 2px; height: 96px; padding-top: 4px; }
.hm-bar { flex: 1; min-width: 2px; border-radius: 1.5px 1.5px 0 0; background: linear-gradient(180deg, var(--accent-2), var(--accent)); opacity: 0.85; }
.hm-bar:hover { opacity: 1; }
.hm-bar.zero { background: var(--border); opacity: 0.35; }
.hm-svg { width: 100%; height: 120px; display: block; }
.hm-legend { display: flex; align-items: center; gap: 6px; justify-content: flex-end; margin-top: 6px; font-size: 10.5px; color: var(--text-faint); }
.hm-legend .hm-cell { width: 10px; height: 10px; border-radius: 2px; }
.dts-tip { position: fixed; background: var(--bg-elevated-2); border: 1px solid var(--border-strong); border-radius: 9px; padding: 6px 10px; font-size: 11.5px; color: var(--text); pointer-events: none; z-index: 10000; box-shadow: 0 12px 32px rgba(0,0,0,0.35); white-space: nowrap; }
.dts-bottom { display: flex; gap: 28px; margin-bottom: 4px; }
.dts-col { flex: 1; min-width: 0; }
.dts-col-title { font-size: 13px; font-weight: 700; color: var(--text); margin-bottom: 8px; }
.insight-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 6px; border-radius: 8px; font-size: 12.5px; transition: background 0.15s var(--ease); }
.insight-row:hover { background: var(--bg-inset); }
.insight-row .k { color: var(--text-dim); }
.insight-row .v { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }
.plugin-row { display: flex; align-items: center; gap: 10px; padding: 5px 6px; border-radius: 8px; font-size: 12.5px; transition: background 0.15s var(--ease); }
.plugin-row:hover { background: var(--bg-inset); }
.plugin-icon { width: 26px; height: 26px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 13px; color: #fff; flex-shrink: 0; box-shadow: 0 2px 6px rgba(0,0,0,0.15); }
.plugin-name { flex: 1; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plugin-kind { flex-shrink: 0; font-size: 10.5px; padding: 1px 8px; border-radius: 20px; margin-right: 6px; font-weight: 600; letter-spacing: 0.02em; }
.plugin-kind.skill { background: rgba(139,124,246,0.16); color: #8b7cf6; }
.plugin-kind.plugin { background: rgba(16,185,129,0.14); color: #10b981; }
.plugin-count { color: var(--text-faint); font-size: 12px; font-variant-numeric: tabular-nums; }
`;
		/** 空快照兜底：数据尚未到达时渲染零值骨架，UI 结构不阻断。 */
		const EMPTY_SNAPSHOT = {
			totalConversations: 0,
			totalMessages: 0,
			totalTokens: 0,
			peakTokens: 0,
			maxDurationSec: 0,
			maxDurationText: "0分",
			currentStreak: 0,
			longestStreak: 0,
			dailyTokens: {},
			thinkingLevels: {
				high: 0,
				medium: 0,
				low: 0,
				off: 0
			},
			topTools: [],
			totalToolCalls: 0,
			distinctTools: 0,
			topPlugins: [],
			topSkills: [],
			totalSkillUses: 0,
			distinctSkills: 0,
			typeBreakdown: {},
			modelBreakdown: {},
			earliestDate: "",
			latestDate: "",
			updatedAt: 0
		};
		/** 解析当前主题（面板与入口统一口径）。 */
		function resolvedThemeOf() {
			try {
				const t = localStorage.getItem("dts-theme");
				if (t === "light" || t === "dark") return t;
			} catch {}
			return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
		}
		/**
		* 侧边栏底部入口（`sidebar.footer.action`，应用级常驻）。宽侧栏显示
		* 图标 + 文字，折叠成 rail 时只显示图标。
		*/
		function SidebarStatsEntry({ wide }) {
			react.useSyncExternalStore(subscribe, getSnapshot);
			return h("div", {
				className: "dts-root dts-entry-scope",
				"data-theme": resolvedThemeOf()
			}, h("button", {
				className: "dts-sidebar-entry" + (wide ? "" : " rail"),
				type: "button",
				onClick: () => setOpen(true),
				title: "Token 统计",
				"aria-label": "Token 统计"
			}, h(Icon, {
				name: "sparkles",
				size: 16
			}), wide ? h("span", { className: "dts-sidebar-label" }, "Token 统计") : null));
		}
		/** 会话头部实时用量胶囊（`conversation.session.header.actions`）：⚡ 累计数。 */
		function HeaderStatsCapsule() {
			const data = react.useSyncExternalStore(subscribe, getSnapshot);
			const open = react.useSyncExternalStore(subscribeOpen, getOpen);
			return h("div", {
				className: "dts-root dts-entry-scope",
				"data-theme": resolvedThemeOf()
			}, h("button", {
				className: "dts-header-capsule" + (open ? " active" : ""),
				type: "button",
				onClick: () => setOpen(true),
				title: "Token 统计 · 点击查看详情",
				"aria-label": "Token 统计"
			}, h(Icon, {
				name: "sparkles",
				size: 12
			}), h("span", { className: "dts-header-total" }, data ? fmtTok(data.totalTokens) : "统计中")));
		}
		function TokenStatsPanel() {
			const data = react.useSyncExternalStore(subscribe, getSnapshot);
			const error = react.useSyncExternalStore(subscribe, getError);
			const open = react.useSyncExternalStore(subscribeOpen, getOpen);
			const [hmMode, setHmMode] = react.useState("daily");
			const [theme, setTheme] = react.useState(() => {
				try {
					return localStorage.getItem("dts-theme") || "system";
				} catch {
					return "system";
				}
			});
			const [tip, setTip] = react.useState(null);
			const [profile, setProfile] = react.useState(loadProfile);
			const [avatarOpen, setAvatarOpen] = react.useState(false);
			const [avatarTab, setAvatarTab] = react.useState("emoji");
			const [nameEditing, setNameEditing] = react.useState(false);
			const [draftName, setDraftName] = react.useState("");
			const fileInputRef = react.useRef(null);
			const resolvedTheme = theme === "system" ? window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark" : theme;
			react.useEffect(() => {
				if (!avatarOpen && !nameEditing) return;
				const onDocMouseDown = (e) => {
					const t = e.target;
					if (t && t.closest && (t.closest(".dts-avatar-wrap") || t.closest(".dts-user-edit"))) return;
					setAvatarOpen(false);
					setNameEditing(false);
				};
				document.addEventListener("mousedown", onDocMouseDown);
				return () => document.removeEventListener("mousedown", onDocMouseDown);
			}, [avatarOpen, nameEditing]);
			react.useEffect(() => {
				const onKeyDown = (e) => {
					if (e.key !== "Escape") return;
					if (avatarOpen || nameEditing) {
						setAvatarOpen(false);
						setNameEditing(false);
					} else if (open) setOpen(false);
				};
				document.addEventListener("keydown", onKeyDown);
				return () => document.removeEventListener("keydown", onKeyDown);
			}, [
				avatarOpen,
				nameEditing,
				open
			]);
			const toggleTheme = () => {
				const next = resolvedTheme === "dark" ? "light" : "dark";
				setTheme(next);
				try {
					localStorage.setItem("dts-theme", next);
				} catch {}
			};
			const commitProfile = () => {
				const next = {
					avatar: profile.avatar,
					kind: profile.kind,
					name: draftName.trim() || "DSH"
				};
				setProfile(next);
				saveProfile(next);
				setNameEditing(false);
			};
			const setAvatar = (avatar, kind) => {
				const next = {
					avatar,
					kind,
					name: draftName.trim() || profile.name
				};
				setProfile(next);
				saveProfile(next);
				setAvatarOpen(false);
			};
			const pickEmoji = (emoji) => setAvatar(emoji, "emoji");
			const handleFile = (file) => {
				if (!file || !file.type.startsWith("image/")) return;
				const reader = new FileReader();
				reader.onload = () => {
					const img = new Image();
					img.onload = () => {
						const canvas = document.createElement("canvas");
						const SIZE = 256;
						canvas.width = SIZE;
						canvas.height = SIZE;
						const ctx = canvas.getContext("2d");
						if (!ctx) return;
						const scale = Math.max(SIZE / img.width, SIZE / img.height);
						const sw = SIZE / scale;
						const sh = SIZE / scale;
						const sx = (img.width - sw) / 2;
						const sy = (img.height - sh) / 2;
						ctx.drawImage(img, sx, sy, sw, sh, 0, 0, SIZE, SIZE);
						let dataUrl;
						try {
							dataUrl = canvas.toDataURL("image/webp", .9);
						} catch {
							dataUrl = canvas.toDataURL("image/png");
						}
						setAvatar(dataUrl, "image");
					};
					img.onerror = () => {
						setAvatarOpen(false);
					};
					img.src = String(reader.result);
				};
				reader.readAsDataURL(file);
			};
			const toggleAvatar = () => {
				setAvatarOpen((v) => !v);
				setNameEditing(false);
			};
			const startNameEdit = () => {
				setDraftName(profile.name);
				setNameEditing(true);
				setAvatarOpen(false);
			};
			const avatarDisplay = profile.kind === "image" ? h("img", {
				className: "dts-avatar-img",
				src: profile.avatar,
				alt: "avatar"
			}) : h("span", { className: "dts-avatar-emoji" }, profile.avatar);
			if (!open) return null;
			const s = data ?? EMPTY_SNAPSHOT;
			const loading = data === null;
			const fetchedAt = /* @__PURE__ */ new Date();
			const hm = String(fetchedAt.getHours()).padStart(2, "0");
			const mm = String(fetchedAt.getMinutes()).padStart(2, "0");
			const userSub = `${s.earliestDate || "—"} → ${s.latestDate || "—"} · 更新于 ${hm}:${mm}`;
			const metrics = h("div", { className: "dts-metrics" }, h("div", { className: "dts-metric" }, h("div", { className: "m-num accent" }, fmtYi(s.totalTokens), h("span", { className: "unit" }, "亿")), h("div", { className: "m-label" }, "累计 Token")), h("div", { className: "dts-metric" }, h("div", { className: "m-num" }, fmtYi(s.peakTokens), h("span", { className: "unit" }, "亿")), h("div", { className: "m-label" }, "峰值 Token")), h("div", { className: "dts-metric" }, h("div", { className: "m-num" }, s.maxDurationText || "0分"), h("div", { className: "m-label" }, "最长聊天时长")), h("div", { className: "dts-metric" }, h("div", { className: "m-num" }, s.currentStreak ?? 0, h("span", { className: "unit" }, "天")), h("div", { className: "m-label" }, "当前连续")), h("div", { className: "dts-metric" }, h("div", { className: "m-num" }, s.longestStreak ?? 0, h("span", { className: "unit" }, "天")), h("div", { className: "m-label" }, "最长连续")));
			const tl = s.thinkingLevels;
			const tlTotal = Object.values(tl).reduce((a, b) => a + b, 0);
			const tlTop = Object.entries(tl).sort((a, b) => b[1] - a[1])[0];
			const tlName = {
				high: "高",
				medium: "中",
				low: "低",
				off: "关闭"
			};
			const tlPct = tlTop && tlTotal ? Math.round(tlTop[1] / tlTotal * 100) : 0;
			const insightRows = [
				["最常用推理强度", tlTop ? `${tlName[tlTop[0]] || tlTop[0]} · ${tlPct}%` : "—"],
				["使用过 Skill", `${s.distinctSkills ?? 0} 个 · ${fmtInt(s.totalSkillUses ?? 0)} 次`],
				["聊天总数", fmtInt(s.totalConversations ?? 0)],
				["总消息数", fmtInt(s.totalMessages ?? 0)],
				["工具调用总数", fmtInt(s.totalToolCalls ?? 0)],
				["已探索工具", `${s.distinctTools ?? 0} 种`]
			];
			const insight = h("div", { className: "dts-col" }, h("div", { className: "dts-col-title" }, "活动洞察"), insightRows.map(([k, v]) => h("div", {
				className: "insight-row",
				key: k
			}, h("span", { className: "k" }, k), h("span", { className: "v" }, v))));
			const skillList = (s.topSkills || []).map(([n, c]) => [
				n,
				c,
				"skill"
			]);
			const pluginList = (s.topPlugins || []).map(([n, c]) => [
				n,
				c,
				"plugin"
			]);
			const merged = [...skillList, ...pluginList].sort((a, b) => b[1] - a[1]).slice(0, 5);
			const plugins = merged.length ? merged.map(([name, cnt, kind]) => {
				const short = shortName(name);
				return h("div", {
					className: "plugin-row",
					key: kind + ":" + name
				}, h("div", {
					className: "plugin-icon",
					style: { background: TOOL_COLORS[hashIdx(name)] }
				}, kind === "skill" ? "🧩" : TOOL_ICONS[name] || TOOL_ICONS[short] || "🔌"), h("span", {
					className: "plugin-name",
					title: name
				}, `$${short}`), h("span", { className: "plugin-kind " + kind }, kind === "skill" ? "Skill" : "插件"), h("span", { className: "plugin-count" }, `${fmtInt(cnt)} 次`));
			}) : h("div", { style: {
				color: "var(--text-faint)",
				fontSize: 13
			} }, "暂无数据");
			const pluginCol = h("div", { className: "dts-col" }, h("div", { className: "dts-col-title" }, "最常用的插件"), plugins);
			const avatarPicker = avatarOpen ? h("div", { className: "dts-avatar-picker" }, h("div", { className: "dts-picker-tabs" }, h("button", {
				type: "button",
				className: "dts-picker-tab" + (avatarTab === "emoji" ? " active" : ""),
				onClick: () => setAvatarTab("emoji")
			}, "表情"), h("button", {
				type: "button",
				className: "dts-picker-tab" + (avatarTab === "image" ? " active" : ""),
				onClick: () => setAvatarTab("image")
			}, "图片")), avatarTab === "emoji" ? h("div", { className: "dts-avatar-grid" }, AVATAR_CHOICES.map((emoji) => h("button", {
				key: emoji,
				type: "button",
				className: "dts-avatar-opt" + (profile.kind === "emoji" && emoji === profile.avatar ? " active" : ""),
				onClick: () => pickEmoji(emoji)
			}, emoji))) : h("div", { className: "dts-avatar-upload" }, h("button", {
				type: "button",
				className: "dts-upload-btn",
				onClick: () => {
					if (fileInputRef.current) fileInputRef.current.click();
				}
			}, h(Icon, {
				name: "upload",
				size: 20
			}), "选择本地图片"), h("input", {
				ref: fileInputRef,
				type: "file",
				accept: "image/*",
				style: { display: "none" },
				onChange: (e) => {
					const f = e.target.files && e.target.files[0];
					if (f) handleFile(f);
					e.target.value = "";
				}
			}), profile.kind === "image" ? h("button", {
				type: "button",
				className: "dts-upload-clear",
				onClick: () => setAvatar("🧑‍💻", "emoji")
			}, h(Icon, {
				name: "trash",
				size: 14
			}), "恢复默认") : null, h("div", { className: "dts-upload-hint" }, "支持 JPG / PNG / WebP，自动裁剪为圆形头像"))) : null;
			const modal = h("div", {
				className: "dts-panel",
				onClick: (e) => {
					if (e.target === e.currentTarget) setOpen(false);
				}
			}, h("div", { className: "dts-panel-content" }, h("div", { className: "dts-stats-body" }, error !== null && data !== null ? h("div", { className: "dts-stale-note" }, `刷新失败：${error}，显示上次数据`) : null, h("div", { className: "dts-top-actions" }, h("button", {
				className: "dts-icon-btn",
				type: "button",
				onClick: toggleTheme,
				title: resolvedTheme === "dark" ? "切换到浅色" : "切换到深色",
				"aria-label": "切换主题"
			}, h(Icon, {
				name: resolvedTheme === "dark" ? "sun" : "moon",
				size: 15
			})), h("button", {
				className: "dts-icon-btn",
				type: "button",
				onClick: () => setOpen(false),
				"aria-label": "关闭"
			}, h(Icon, {
				name: "close",
				size: 15
			}))), h("div", { className: "dts-user" }, h("div", { className: "dts-avatar-wrap" }, h("div", {
				className: "dts-avatar-ring",
				onClick: toggleAvatar,
				title: "点击更换头像"
			}, h("div", { className: "dts-avatar" }, avatarDisplay), h("div", { className: "dts-avatar-hover" }, h(Icon, {
				name: "camera",
				size: 16
			}))), avatarPicker), nameEditing ? h("div", { className: "dts-user-edit" }, h("input", {
				className: "dts-name-input",
				value: draftName,
				placeholder: "输入昵称…",
				maxLength: 20,
				autoFocus: true,
				onChange: (e) => setDraftName(e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter") commitProfile();
				}
			}), h("div", { className: "dts-edit-actions" }, h("button", {
				className: "dts-edit-btn primary",
				type: "button",
				onClick: commitProfile
			}, "保存"), h("button", {
				className: "dts-edit-btn",
				type: "button",
				onClick: () => setNameEditing(false)
			}, "取消"))) : h("div", {
				className: "dts-user-name",
				onClick: startNameEdit,
				title: "点击编辑昵称"
			}, profile.name, h("span", { className: "dts-name-edit-icon" }, h(Icon, {
				name: "pencil",
				size: 13
			}))), h("div", { className: "dts-user-sub" }, userSub)), metrics, h(Heatmap, {
				data,
				hmMode,
				setHmMode,
				tip,
				setTip,
				loading
			}), h("div", { className: "dts-bottom" }, insight, pluginCol))));
			return h("div", {
				className: "dts-root",
				"data-theme": resolvedTheme,
				style: { pointerEvents: "auto" }
			}, modal, tip ? h("div", {
				className: "dts-tip",
				style: {
					left: tip.x,
					top: tip.y
				}
			}, tip.text) : null);
		}
		function Heatmap({ data, hmMode, setHmMode, tip: _tip, setTip, loading }) {
			const daily = data && data.dailyTokens || {};
			const today = /* @__PURE__ */ new Date();
			const start = new Date(today.getFullYear(), today.getMonth() - 11, 1);
			start.setDate(start.getDate() - start.getDay());
			const dayList = [];
			for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) dayList.push(new Date(d));
			const valOf = (d) => daily[dayKeyOf(d)] || 0;
			const showTip = (e, d, kind) => {
				const v = valOf(d);
				positionTip(e, kind === "w" ? `${d.getMonth() + 1}月${d.getDate()}日 当周使用了 ${fmtTok(weekSum(d))} Token` : kind === "c" ? `截至${d.getMonth() + 1}月${d.getDate()}日 累计 ${fmtTok(v)} Token` : `${d.getMonth() + 1}月${d.getDate()}日 使用了 ${fmtTok(v)} Token`);
			};
			const positionTip = (e, text) => {
				const rect = e.currentTarget ? e.currentTarget.getBoundingClientRect() : null;
				let x = e.clientX + 14;
				const y = e.clientY + 14;
				setTip({
					x,
					y,
					text
				});
				if (rect) requestAnimationFrame(() => {
					const el = document.querySelector(".dts-tip");
					if (el) {
						const r = el.getBoundingClientRect();
						if (x + r.width > window.innerWidth) setTip({
							x: e.clientX - r.width - 10,
							y,
							text
						});
					}
				});
			};
			const hideTip = () => setTip(null);
			const weekSum = (d) => {
				let sum = 0;
				for (let i = 0; i < 7; i++) {
					const dd = new Date(d);
					dd.setDate(dd.getDate() + i);
					sum += valOf(dd);
				}
				return sum;
			};
			let body;
			if (hmMode === "weekly") {
				const pad = start.getDay();
				const cellCount = dayList.length + pad;
				const weeks = Math.ceil(cellCount / 7);
				const cellArr = [];
				for (let i = 0; i < weeks * 7; i++) {
					const dayIdx = i - pad;
					cellArr.push(dayIdx >= 0 && dayIdx < dayList.length ? dayList[dayIdx] : null);
				}
				const weekSums = [];
				for (let w = 0; w < weeks; w++) {
					let sum = 0;
					for (let r = 0; r < 7; r++) {
						const d = cellArr[w * 7 + r];
						if (d) sum += valOf(d);
					}
					weekSums.push(sum);
				}
				const maxW = Math.max(...weekSums, 1);
				const wMonthSpans = [];
				let wLastM = -1;
				for (let w = 0; w < weeks; w++) {
					const d = cellArr[w * 7 + pad] || null;
					const m = d ? d.getMonth() : -1;
					wMonthSpans.push(d && m !== wLastM ? `${m + 1}月` : "");
					if (d && m !== wLastM) wLastM = m;
				}
				body = h("div", null, h("div", { className: "hm-months" }, wMonthSpans.map((t, i) => h("span", { key: i }, t))), h("div", { className: "hm-bars" }, weekSums.map((sum, i) => {
					const d0 = cellArr[i * 7 + pad] || cellArr[i * 7] || dayList[0];
					const hh = sum > 0 ? Math.max(4, Math.round(sum / maxW * 96)) : 2;
					return h("div", {
						key: i,
						className: "hm-bar" + (sum > 0 ? "" : " zero"),
						style: { height: `${hh}px` },
						onMouseEnter: (e) => showTip(e, d0, "w"),
						onMouseLeave: hideTip
					});
				})));
			} else if (hmMode === "cumulative") {
				let acc = 0;
				const pts = dayList.map((d) => {
					acc += valOf(d);
					return [d, acc];
				});
				const W = 940;
				const H = 140;
				const P = {
					l: 52,
					r: 10,
					t: 8,
					b: 22
				};
				const maxV = Math.max(...pts.map((p) => p[1]), 1);
				const px = (i) => P.l + i / (pts.length - 1 || 1) * (W - P.l - P.r);
				const py = (v) => H - P.b - v / maxV * (H - P.t - P.b);
				const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(p[1]).toFixed(1)}`).join(" ");
				const area = `${line} L${px(pts.length - 1)},${H - P.b} L${px(0)},${H - P.b} Z`;
				const yTicks = [
					0,
					.25,
					.5,
					.75,
					1
				].map((f) => ({
					v: maxV * f,
					y: py(maxV * f)
				}));
				const fmtShort = (v) => v >= 1e8 ? `${(v / 1e8).toFixed(1)}亿` : v >= 1e4 ? `${(v / 1e4).toFixed(0)}万` : String(v);
				const yGrid = yTicks.map((t, i) => h("g", { key: "y" + i }, h("line", {
					x1: P.l,
					y1: t.y,
					x2: W - P.r,
					y2: t.y,
					stroke: "var(--border)",
					strokeWidth: 1
				}), h("text", {
					x: P.l - 8,
					y: t.y + 4,
					textAnchor: "end",
					fontSize: 10,
					fill: "var(--text-faint)"
				}, fmtShort(t.v))));
				const xTicks = [];
				let lastM = -1;
				for (let i = 0; i < pts.length; i++) {
					const m = pts[i][0].getMonth();
					if (m !== lastM) {
						xTicks.push({
							i,
							m
						});
						lastM = m;
					}
				}
				const xLabels = xTicks.map((t) => h("text", {
					key: "x" + t.i,
					x: px(t.i),
					y: H - 8,
					textAnchor: "middle",
					fontSize: 10,
					fill: "var(--text-faint)"
				}, `${t.m + 1}月`));
				const cumPts = pts.map((p, i) => ({
					day: dayKeyOf(p[0]),
					acc: p[1],
					x: px(i)
				}));
				const svgRef = react.useRef(null);
				const onMove = (e) => {
					const svg = svgRef.current;
					if (!svg) return;
					const r = svg.getBoundingClientRect();
					const viewX = (e.clientX - r.left) / r.width * W;
					let best = 0;
					let bestDist = Infinity;
					for (let i = 0; i < cumPts.length; i++) {
						const dist = Math.abs(cumPts[i].x - viewX);
						if (dist < bestDist) {
							bestDist = dist;
							best = i;
						}
					}
					const p = cumPts[best];
					const d = /* @__PURE__ */ new Date(`${p.day}T00:00:00+08:00`);
					positionTip(e, `截至${d.getMonth() + 1}月${d.getDate()}日 累计 ${fmtTok(p.acc)} Token`);
				};
				body = h("svg", {
					ref: svgRef,
					className: "hm-svg",
					viewBox: `0 0 ${W} ${H}`,
					preserveAspectRatio: "none",
					style: {
						width: "100%",
						height: 140
					},
					onMouseMove: onMove,
					onMouseLeave: hideTip
				}, h("defs", null, h("linearGradient", {
					id: "dtsHmArea",
					x1: 0,
					y1: 0,
					x2: 0,
					y2: 1
				}, h("stop", {
					offset: "0%",
					stopColor: "#8b7cf6",
					stopOpacity: .32
				}), h("stop", {
					offset: "100%",
					stopColor: "#8b7cf6",
					stopOpacity: .02
				}))), yGrid, h("path", {
					d: area,
					fill: "url(#dtsHmArea)"
				}), h("path", {
					d: line,
					fill: "none",
					stroke: "#8b7cf6",
					strokeWidth: 1.8
				}), xLabels);
			} else {
				const pad = start.getDay();
				const cellCount = dayList.length + pad;
				const weeks = Math.ceil(cellCount / 7);
				const cellArr = [];
				for (let i = 0; i < weeks * 7; i++) {
					const dayIdx = i - pad;
					cellArr.push(dayIdx >= 0 && dayIdx < dayList.length ? dayList[dayIdx] : null);
				}
				const monthSpans = [];
				let lastM = -1;
				for (let w = 0; w < weeks; w++) {
					const d = cellArr[w * 7 + pad] || null;
					const m = d ? d.getMonth() : -1;
					monthSpans.push(d && m !== lastM ? `${m + 1}月` : "");
					if (d && m !== lastM) lastM = m;
				}
				const levels = hmLevelsOf(daily);
				body = h("div", null, h("div", { className: "hm-months" }, monthSpans.map((t, i) => h("span", { key: i }, t))), h("div", { className: "hm-grid" }, cellArr.map((d, i) => {
					if (!d) return h("div", {
						className: "hm-cell",
						key: i
					});
					return h("div", {
						key: i,
						className: `hm-cell l${levelOf(valOf(d), levels)}`,
						onMouseEnter: (e) => showTip(e, d, "d"),
						onMouseLeave: hideTip
					});
				})));
			}
			const legend = hmMode === "daily" ? h("div", { className: "hm-legend" }, h("span", null, "少"), [
				0,
				1,
				2,
				3,
				4,
				5,
				6
			].map((l) => h("div", {
				className: `hm-cell l${l}`,
				key: l
			})), h("span", null, "多")) : h("div", { className: "hm-legend" }, hmMode === "weekly" ? h("span", null, `${dayList.length} 天 · ${Math.ceil((dayList.length + start.getDay()) / 7)} 周`) : h("span", null, `累计 ${fmtTok(Object.values(daily).reduce((a, b) => a + b, 0))} · ${dayList.length} 天`));
			return h("div", { className: "dts-heatmap" }, h("div", { className: "hm-header" }, h("div", { className: "hm-title" }, "Token 活动", loading ? h("span", {
				className: "dts-loading-badge",
				title: "正在统计 Token 用量…"
			}, h("span", { className: "dts-loading-dot" }), "统计中") : null), h("div", { className: "hm-tabs" }, [
				"daily",
				"weekly",
				"cumulative"
			].map((mode) => h("button", {
				key: mode,
				className: "hm-tab" + (hmMode === mode ? " active" : ""),
				onClick: () => setHmMode(mode),
				type: "button"
			}, mode === "daily" ? "每日" : mode === "weekly" ? "每周" : "累计")))), h("div", { className: "hm-wrap" }, body), legend);
		}
		/** Required services: slot registry + the generic RPC channel. */
		const inject = ["slots", "connection"];
		/**
		* Mount the panel: inject styles, poll the host snapshot, register the
		* `shell.overlay` modal plus the two entry points (sidebar footer + session
		* header capsule).
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => {
				const tagId = "dsh-token-stats-styles";
				let tag = null;
				if (!document.getElementById(tagId)) {
					tag = document.createElement("style");
					tag.id = tagId;
					tag.textContent = PANEL_CSS;
					document.head.appendChild(tag);
				}
				return () => {
					if (tag) tag.remove();
				};
			}, "dsh-token-stats: styles");
			const connection = ctx.get("connection");
			const refresh = async () => {
				try {
					const result = await connection.rpc.call("/api", "tokenStats/getStats", { args: {} });
					if (result.ok) {
						latest = result.value;
						lastError = null;
					} else lastError = `${result.error.code}: ${result.error.message}`;
				} catch (err) {
					lastError = err instanceof Error ? err.message : String(err);
				}
				notify();
			};
			ctx.effect(() => {
				refresh();
				const timer = setInterval(() => {
					refresh();
				}, 5e3);
				const disposeOverlay = ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: "token-stats",
					order: 100,
					label: "Token 统计"
				}, TokenStatsPanel));
				const disposeSidebar = ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
					name: "sidebar.footer.action",
					id: "token-stats-sidebar"
				}, SidebarStatsEntry));
				const disposeHeader = ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
					name: "conversation.session.header.actions",
					id: "token-stats-header",
					order: 90
				}, HeaderStatsCapsule));
				return () => {
					clearInterval(timer);
					if (typeof disposeOverlay === "function") disposeOverlay();
					if (typeof disposeSidebar === "function") disposeSidebar();
					if (typeof disposeHeader === "function") disposeHeader();
				};
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map