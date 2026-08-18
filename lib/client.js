// dsh-page-preview — client half (real DSH plugin, permanent install)
// Floating movable/resizable preview window + top-right capsule for the
// registered preview, and inline preview panes extracted from
// `html page-preview` code fences (turnTail chain entry).
// Content renders at a virtual desktop width (>=1024px) and scales to fit
// so small windows keep desktop layout proportions instead of squashing the
// page; closing morphs the window into the top-right capsule.
window.__ModuleLoader__.load({
	id: "dsh-page-preview",
	factory: (require) => {
		const React = require("react");

		const RPC_CHANNEL = "/dsh-page-preview";
		const IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads";
		// Served-route iframes (src=reg.url) load from the host webserver origin;
		// allow-scripts + allow-same-origin there is no sandbox. Drop same-origin for
		// served pages; inline srcdoc (opaque origin) keeps it.
		const IFRAME_SANDBOX_SERVED = "allow-scripts allow-forms allow-modals allow-popups allow-downloads";
		const VIRTUAL_MIN_WIDTH = 1024;

		const CSS = [
			'.dsh-pv-win { position: fixed; right: 16px; bottom: 16px; z-index: 4000; display: flex; flex-direction: column; width: 560px; height: 420px; max-width: 85vw; max-height: 85vh; background: Canvas; color: CanvasText; border: 1px solid rgba(128,128,128,.32); border-radius: 10px; box-shadow: 0 12px 40px rgba(0,0,0,.28); overflow: hidden; font-size: 12px; animation: dsh-pv-win-in .22s cubic-bezier(.2,.7,.3,1); transition: transform .32s cubic-bezier(.5,-.08,.35,1), opacity .32s ease, border-radius .32s ease, box-shadow .2s ease; }',
			'.dsh-pv-win[data-dragging="true"] { box-shadow: 0 20px 56px rgba(0,0,0,.4); }',
			'@keyframes dsh-pv-win-in { from { opacity: 0; transform: translateY(18px) scale(.97); } to { opacity: 1; transform: none; } }',
			'.dsh-pv-win-closing { pointer-events: none !important; opacity: 0 !important; border-radius: 999px !important; }',
			'.dsh-pv-win-head { display: flex; align-items: center; gap: 2px; padding: 6px 8px 6px 12px; border-bottom: 1px solid rgba(128,128,128,.3); cursor: move; touch-action: none; user-select: none; }',
			'.dsh-pv-win-head:active { cursor: grabbing; }',
			'.dsh-pv-kind { flex: 0 0 auto; margin-right: 8px; padding: 1px 7px; border-radius: 5px; background: rgba(34,197,94,.16); color: #16a34a; font-weight: 600; }',
			'.dsh-pv-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }',
			'.dsh-pv-iconbtn { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: none; border-radius: 6px; background: transparent; color: CanvasText; opacity: .7; cursor: pointer; text-decoration: none; transition: opacity .15s ease, background-color .15s ease, color .15s ease, transform .12s ease; }',
			'.dsh-pv-iconbtn:hover { opacity: 1; background: rgba(34,197,94,.13); color: #16a34a; transform: translateY(-1px); }',
			'.dsh-pv-iconbtn:active { transform: translateY(0) scale(.92); }',
			'.dsh-pv-content { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; background: #fff; }',
			'.dsh-pv-frame { display: block; width: 100%; height: 100%; border: 0; background: #fff; }',
			'.dsh-pv-frame-scaled { position: absolute; left: 0; top: 0; border: 0; background: #fff; transform-origin: top left; }',
			'.dsh-pv-win-resize { position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: nwse-resize; touch-action: none; z-index: 6; }',
			'.dsh-pv-win-resize::after { content: ""; position: absolute; right: 5px; bottom: 5px; width: 8px; height: 8px; border-right: 2px solid rgba(128,128,128,.55); border-bottom: 2px solid rgba(128,128,128,.55); border-bottom-right-radius: 3px; opacity: 0; transition: opacity .15s ease; }',
			'.dsh-pv-win:hover .dsh-pv-win-resize::after { opacity: 1; }',
			'.dsh-pv-fs { position: fixed; inset: 0; z-index: 5000; display: flex; flex-direction: column; background: Canvas; color: CanvasText; font-size: 12px; box-shadow: 0 0 80px rgba(0,0,0,.4); animation: dsh-pv-fs-in .22s cubic-bezier(.2,.7,.3,1); transition: transform .32s cubic-bezier(.5,-.08,.35,1), opacity .32s ease, border-radius .32s ease; }',
			'@keyframes dsh-pv-fs-in { from { opacity: 0; transform: scale(.985); } to { opacity: 1; transform: none; } }',
			'.dsh-pv-capsule { pointer-events: auto; position: fixed; top: 14px; right: 14px; z-index: 4000; display: flex; align-items: center; gap: 8px; max-width: 46vw; padding: 6px 8px 6px 12px; border-radius: 999px; border: 1px solid rgba(34,197,94,.45); background: Canvas; color: CanvasText; box-shadow: 0 2px 10px rgba(0,0,0,.18); cursor: pointer; font-size: 12px; line-height: 1.4; animation: dsh-pv-cap-in .22s cubic-bezier(.2,.7,.3,1); transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease; }',
			'.dsh-pv-capsule:hover { border-color: #22c55e; box-shadow: 0 4px 16px rgba(34,197,94,.3); transform: translateY(-1px); }',
			'@keyframes dsh-pv-cap-in { from { opacity: 0; transform: scale(.8) translateY(4px); } to { opacity: 1; transform: none; } }',
			'.dsh-pv-dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 8px rgba(34,197,94,.9); animation: dsh-pv-breathe 2.2s ease-in-out infinite; }',
			'@keyframes dsh-pv-breathe { 0%, 100% { opacity: .4; transform: scale(.75); } 50% { opacity: 1; transform: scale(1.2); } }',
			'.dsh-pv-cap-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }',
			'.dsh-pv-cap-arrow { flex: 0 0 auto; display: inline-flex; opacity: .7; }',
			'.dsh-pv-inline { margin: 2px 0 10px; display: flex; flex-direction: column; gap: 10px; }',
			'.dsh-pv-inline-pane { border: 1px solid rgba(128,128,128,.35); border-radius: 10px; overflow: hidden; background: Canvas; box-shadow: 0 2px 12px rgba(0,0,0,.08); }',
			'.dsh-pv-inline-head { display: flex; align-items: center; gap: 2px; padding: 4px 6px 4px 12px; border-bottom: 1px solid rgba(128,128,128,.25); color: CanvasText; }',
			'.dsh-pv-inline-title { flex: 0 0 auto; margin-right: 8px; font-size: 12px; font-weight: 600; color: CanvasText; opacity: .9; }',
			'.dsh-pv-inline-frame { display: block; width: 100%; height: 420px; border: 0; background: #fff; }',
			'.dsh-pv-fs .dsh-pv-inline-frame { flex: 1 1 auto; height: auto; min-height: 0; }',
			'.dsh-pv-files { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: CanvasText; }',
			'.dsh-pv-files-label { opacity: .8; }',
			'.dsh-pv-file-chip { padding: 2px 8px; border-radius: 6px; border: 1px solid rgba(128,128,128,.4); background: transparent; color: CanvasText; cursor: pointer; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: border-color .15s ease, color .15s ease; }',
			'.dsh-pv-file-chip:hover { border-color: #22c55e; color: #16a34a; }',
			'.dsh-pv-more { opacity: .75; white-space: nowrap; }',
		].join('\n');

		const styleTagId = "dsh-page-preview/styles";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleTagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-page-preview";
			tag.dataset.pluginCss = styleTagId;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		function extractFences(text) {
			const out = [];
			const patterns = [
				/```(?:html|htm)\s+(?:page-preview|dsh-preview)\b[^\n]*\n([\s\S]*?)\n?```/g,
				/```(?:page-preview|dsh-preview)\s*\n([\s\S]*?)\n?```/g,
			];
			for (let p = 0; p < patterns.length; p++) {
				const re = patterns[p];
				let m;
				while ((m = re.exec(text)) !== null) {
					const body = m[1];
					if (typeof body === 'string' && body.trim().length > 0) out.push(body);
				}
			}
			return out;
		}

		function basename(path) {
			const s = String(path);
			const at = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
			return at === -1 ? s : s.slice(at + 1);
		}

		function producedPathsBefore(data, seq) {
			if (!data || !Array.isArray(data.produced)) return [];
			const paths = [];
			const seen = {};
			for (let i = 0; i < data.produced.length; i++) {
				const p = data.produced[i];
				if (!p || typeof p.path !== 'string') continue;
				if (typeof p.seq === 'number' && seq !== undefined && p.seq > seq) continue;
				if (seen[p.path]) continue;
				seen[p.path] = true;
				paths.push(p.path);
			}
			return paths;
		}

		const ICONS = {
			refresh: 'M23 4v6h-6M20.49 15a9 9 0 1 1-2.12-9.36L23 10',
			external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
			close: 'M18 6 6 18M6 6l12 12',
			collapse: 'M18 15l-6-6-6 6',
			expand: 'M6 9l6 6 6-6',
			fullscreen: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
			restore: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7',
			chevronRight: 'M9 18l6-6-6-6',
		};

		function viewportSize() {
			try {
				const doc = document.documentElement;
				if (doc && typeof doc.clientWidth === 'number' && doc.clientWidth > 0) {
					return { vw: doc.clientWidth, vh: doc.clientHeight };
				}
			} catch (err) { /* fall through */ }
			return { vw: 1920, vh: 1080 };
		}

		/**
		 * Client plugin body: register the shell overlay (floating window +
		 * capsule) and the turn-tail chain entry (inline fence previews).
		 * @param ctx - client cordis context.
		 */
		function apply(ctx) {
			const connection = ctx.connection;
			const host = (() => {
				// Fallback transport: talks the raw client-request/server-response
				// wire protocol directly. Used while the host still returns
				// un-enveloped business objects (pre-restart host code), which the
				// platform's zod validation inside connection.rpc.call rejects.
				const rawCall = async (method, args) => {
					const response = await window.fetch(RPC_CHANNEL + '/' + method, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({
							type: 'client-request',
							rpcId: 'pv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10),
							method,
							payload: args ?? {},
						}),
					});
					if (!response.ok) throw new Error('preview rpc HTTP ' + response.status);
					const full = await response.json();
					return full && typeof full === 'object' ? full.result : undefined;
				};
				return {
					async call(method, args) {
						try {
							const res = await connection.rpc.call(RPC_CHANNEL, method, args ?? {});
							// Platform envelope: { ok: true, value } | { ok: false, error }.
							if (res && typeof res === 'object' && ('value' in res || 'error' in res)) {
								if (res.ok === true) return res.value;
								throw new Error((res.error && res.error.message) || 'preview rpc failed');
							}
							// Old host protocol: raw business object.
							return res;
						} catch (err) {
							if (err && err.name === 'ZodError') return rawCall(method, args ?? {});
							throw err;
						}
					},
				};
			})();
			const slots = ctx.slots;

			const store = {
				state: { sessionId: null, registration: null, closedBySession: {}, lastTokenBySession: {} },
				listeners: new Set(),
				get() { return this.state; },
				set(next) { this.state = next; for (const fn of this.listeners) fn(); },
				subscribe(fn) { this.listeners.add(fn); return () => { this.listeners.delete(fn); } },
			};

			function usePreviewStore() {
				const [, setTick] = React.useState(0);
				React.useEffect(() => store.subscribe(() => setTick((t) => t + 1)), []);
				return store.get();
			}

			function SvgIcon(props) {
				return React.createElement('svg', {
					viewBox: '0 0 24 24',
					width: 14,
					height: 14,
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.7,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
					'aria-hidden': 'true',
				}, React.createElement('path', { d: props.d }));
			}

			function IconButton(props) {
				return React.createElement('button', {
					type: 'button',
					className: 'dsh-pv-iconbtn',
					title: props.title,
					'aria-label': props.title,
					onClick: props.onClick,
				}, React.createElement(SvgIcon, { d: props.icon }));
			}

			function IconLink(props) {
				return React.createElement('a', {
					className: 'dsh-pv-iconbtn',
					href: props.href,
					target: '_blank',
					rel: 'noreferrer',
					title: props.title,
					'aria-label': props.title,
				}, React.createElement(SvgIcon, { d: props.icon }));
			}

			function InlinePreview(props) {
				const html = props.html;
				const [snippetUrl, setSnippetUrl] = React.useState(null);
				const [collapsed, setCollapsed] = React.useState(false);
				const [fs, setFs] = React.useState(false);

				React.useEffect(() => {
					let alive = true;
					const save = async () => {
						try {
							const res = await host.call('snippet-save', { html });
							if (alive && res && res.ok && typeof res.url === 'string') setSnippetUrl(res.url);
						} catch (err) { /* host unavailable: srcdoc-only mode */ }
					};
					save();
					return () => { alive = false; };
				}, [html]);

				const title = '页面预览 #' + (props.index + 1);

				const head = React.createElement('div', { className: 'dsh-pv-inline-head' },
					React.createElement('span', { className: 'dsh-pv-inline-title' }, title),
					React.createElement('span', { style: { flex: '1 1 auto' } }),
					snippetUrl !== null ? React.createElement(IconLink, { href: snippetUrl, icon: ICONS.external, title: '在新窗口打开' }) : null,
					React.createElement(IconButton, { icon: fs ? ICONS.restore : ICONS.fullscreen, title: fs ? '恢复' : '全屏', onClick: () => setFs(!fs) }),
					fs ? null : React.createElement(IconButton, { icon: collapsed ? ICONS.expand : ICONS.collapse, title: collapsed ? '展开' : '收起', onClick: () => setCollapsed(!collapsed) }),
				);

				if (fs) {
					return React.createElement('div', { className: 'dsh-pv-fs' },
						head,
						React.createElement('iframe', {
							className: 'dsh-pv-inline-frame',
							srcDoc: html,
							sandbox: IFRAME_SANDBOX,
							title,
						}),
					);
				}

				if (collapsed) {
					return React.createElement('div', { className: 'dsh-pv-inline-pane' }, head);
				}

				return React.createElement('div', { className: 'dsh-pv-inline-pane' },
					head,
					React.createElement('iframe', {
						className: 'dsh-pv-inline-frame',
						srcDoc: html,
						sandbox: IFRAME_SANDBOX,
						title,
					}),
				);
			}

			function TurnTailExtras(props) {
				if (typeof props.useSession !== 'function') return null;
				const matched = props.matched;
				const loc = matched && matched.turn;
				const turnNumber = loc && typeof loc.turn === 'number' ? loc.turn : null;
				const seq = matched && typeof matched.seq === 'number' ? matched.seq : undefined;
				const openFile = typeof props.openFile === 'function' ? props.openFile : null;

				const blocks = props.useSession((snapshot) => {
					if (snapshot === null || snapshot === undefined || turnNumber === null) return null;
					try {
						const chat = snapshot.chat;
						if (!chat || !chat.locations || !chat.nodes) return null;
						const keys = chat.locations.getTurn(turnNumber);
						if (!keys) return null;
						for (let i = keys.length - 1; i >= 0; i--) {
							const node = chat.nodes.get(keys[i]);
							if (!node || !node.data) continue;
							let candidate = null;
							if (node.kind === 'turn-tail' && node.data.closing && Array.isArray(node.data.closing.blocks)) candidate = node.data.closing.blocks;
							else if (node.kind === 'assistant-step' && Array.isArray(node.data.blocks)) candidate = node.data.blocks;
							if (candidate !== null) return candidate;
						}
					} catch (err) { return null; }
					return null;
				}, (a, b) => {
					if (a === b) return true;
					if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
					for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
					return true;
				});

				let filePaths = [];
				if (loc && loc.data && typeof loc.data.get === 'function') {
					try {
						filePaths = producedPathsBefore(loc.data.get('deliverables'), seq);
					} catch (err) { filePaths = []; }
				}

				let panes = null;
				if (Array.isArray(blocks)) {
					let text = '';
					for (let i = 0; i < blocks.length; i++) {
						const b = blocks[i];
						if (b && b.kind === 'text' && typeof b.text === 'string') text += b.text;
					}
					const htmls = text === '' ? [] : extractFences(text);
					if (htmls.length > 0) {
						panes = React.createElement('div', { className: 'dsh-pv-inline' },
							htmls.map((html, i) => React.createElement(InlinePreview, { key: 'pv' + i, html, index: i })),
						);
					}
				}

				let filesRow = null;
				if (filePaths.length > 0) {
					const shown = filePaths.slice(0, 3);
					filesRow = React.createElement('div', { className: 'dsh-pv-files' },
						React.createElement('span', { className: 'dsh-pv-files-label' }, '产物'),
						shown.map((path) => React.createElement('button', {
							key: path,
							className: 'dsh-pv-file-chip',
							title: path,
							onClick: openFile !== null ? () => openFile(path) : undefined,
						}, basename(path))),
						filePaths.length > shown.length
							? React.createElement('span', { className: 'dsh-pv-more' }, '+ ' + (filePaths.length - shown.length) + ' 个文件')
							: null,
					);
				}

				if (panes === null && filesRow === null) return null;
				return React.createElement('div', { className: 'dsh-pv-inline' }, panes, filesRow);
			}

			function PreviewWindow(props) {
				const reg = props.reg;
				const sessionId = props.sessionId;
				const [pos, setPos] = React.useState(null);
				const [size, setSize] = React.useState(null);
				const [move, setMove] = React.useState(null);
				const [resize, setResize] = React.useState(null);
				const [fs, setFs] = React.useState(false);
				const [closing, setClosing] = React.useState(null);
				const [box, setBox] = React.useState(null);
				const boxRef = React.useRef(null);
				const morphTimer = React.useRef(null);

				React.useEffect(() => () => {
					if (morphTimer.current !== null) window.clearTimeout(morphTimer.current);
				}, []);

				React.useEffect(() => {
					const el = boxRef.current;
					if (!el) return;
					const measure = () => {
						try {
							// offsetWidth/offsetHeight are layout sizes: unlike
							// getBoundingClientRect they are NOT affected by the mount
							// animation transform (which would shrink the measured box and
							// leave white edges after the animation finishes).
							const w = el.offsetWidth;
							const h = el.offsetHeight;
							if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) setBox({ w, h });
						} catch (err) { /* ignore */ }
					};
					measure();
					let ro = null;
					try {
						if (typeof ResizeObserver === 'function') {
							ro = new ResizeObserver(measure);
							ro.observe(el);
						}
					} catch (err) { ro = null; }
					return () => { if (ro !== null) { try { ro.disconnect(); } catch (e) { /* ignore */ } } };
				}, []);

				const closeWindow = () => {
					if (closing !== null) return;
					const { vw, vh } = viewportSize();
					let left;
					let top;
					let w;
					let h;
					if (fs) {
						left = 0; top = 0; w = vw; h = vh;
					} else {
						w = size ? size.w : 560;
						h = size ? size.h : 420;
						if (pos !== null) { left = pos.left; top = pos.top; } else { left = vw - 16 - w; top = vh - 16 - h; }
					}
					const capW = 220;
					const capH = 34;
					const capLeft = vw - 14 - capW;
					const capTop = 14;
					const dx = (capLeft + capW / 2) - (left + w / 2);
					const dy = (capTop + capH / 2) - (top + h / 2);
					const sx = Math.max(capW / Math.max(w, 1), 0.04);
					const sy = Math.max(capH / Math.max(h, 1), 0.04);
					setClosing({ dx, dy, sx, sy });
					if (morphTimer.current !== null) window.clearTimeout(morphTimer.current);
					morphTimer.current = window.setTimeout(() => {
						const closedBySession = Object.assign({}, store.get().closedBySession, { [sessionId]: true });
						store.set(Object.assign({}, store.get(), { closedBySession }));
					}, 320);
				};
				const refreshPane = () => {
					try { host.call('refresh', { sessionId }).catch(() => {}); } catch (err) { /* ignore */ }
				};

				const onTitleDown = (e) => {
					try {
						if (e.target && typeof e.target.closest === 'function' && e.target.closest('.dsh-pv-iconbtn')) return;
					} catch (err) { /* continue */ }
					let rect = null;
					try {
						const win = e.currentTarget && e.currentTarget.parentElement;
						if (win && typeof win.getBoundingClientRect === 'function') rect = win.getBoundingClientRect();
						if (e.currentTarget && typeof e.currentTarget.setPointerCapture === 'function') e.currentTarget.setPointerCapture(e.pointerId);
					} catch (err) { /* fall back */ }
					const left = rect ? rect.left : 0;
					const top = rect ? rect.top : 0;
					setMove({ pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, left, top });
				};
				const onTitleMove = (e) => {
					if (move === null || move.pointerId !== e.pointerId) return;
					const { vw, vh } = viewportSize();
					const w = size ? size.w : 560;
					const h = size ? size.h : 420;
					const left = Math.max(0, Math.min(move.left + (e.clientX - move.startX), vw - Math.min(w, vw - 80)));
					const top = Math.max(0, Math.min(move.top + (e.clientY - move.startY), vh - Math.min(h, vh - 80)));
					setPos({ left, top });
				};
				const onTitleUp = (e) => {
					if (move !== null && move.pointerId === e.pointerId) setMove(null);
					try {
						if (e.currentTarget && typeof e.currentTarget.releasePointerCapture === 'function') e.currentTarget.releasePointerCapture(e.pointerId);
					} catch (err) { /* ignore */ }
				};

				const onResizeDown = (e) => {
					let rect = null;
					try {
						const win = e.currentTarget && e.currentTarget.parentElement;
						if (win && typeof win.getBoundingClientRect === 'function') rect = win.getBoundingClientRect();
						if (e.currentTarget && typeof e.currentTarget.setPointerCapture === 'function') e.currentTarget.setPointerCapture(e.pointerId);
					} catch (err) { /* fall back */ }
					setResize({ pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, w: rect ? rect.width : 560, h: rect ? rect.height : 420 });
				};
				const onResizeMove = (e) => {
					if (resize === null || resize.pointerId !== e.pointerId) return;
					const { vw, vh } = viewportSize();
					const w = Math.max(320, Math.min(resize.w + (e.clientX - resize.startX), vw - 16));
					const h = Math.max(240, Math.min(resize.h + (e.clientY - resize.startY), vh - 16));
					setSize({ w, h });
				};
				const onResizeUp = (e) => {
					if (resize !== null && resize.pointerId === e.pointerId) setResize(null);
					try {
						if (e.currentTarget && typeof e.currentTarget.releasePointerCapture === 'function') e.currentTarget.releasePointerCapture(e.pointerId);
					} catch (err) { /* ignore */ }
				};

				const headEl = React.createElement('div', {
					className: 'dsh-pv-win-head',
					onPointerDown: onTitleDown,
					onPointerMove: onTitleMove,
					onPointerUp: onTitleUp,
					onPointerCancel: onTitleUp,
					title: '拖动移动窗口',
				},
					React.createElement('span', { className: 'dsh-pv-kind' }, reg.kind === 'path' ? '本地' : '网址'),
					React.createElement('span', { className: 'dsh-pv-label', title: reg.label }, reg.label),
					React.createElement(IconButton, { icon: ICONS.refresh, title: '刷新', onClick: refreshPane }),
					React.createElement(IconLink, { href: reg.url, icon: ICONS.external, title: '在新窗口打开' }),
					React.createElement(IconButton, { icon: fs ? ICONS.restore : ICONS.fullscreen, title: fs ? '恢复' : '全屏', onClick: () => setFs(!fs) }),
					React.createElement(IconButton, { icon: ICONS.close, title: '关闭预览', onClick: closeWindow }),
				);

				if (fs) {
					return React.createElement('div', {
						className: 'dsh-pv-fs' + (closing !== null ? ' dsh-pv-win-closing' : ''),
						style: closing !== null ? { transform: 'translate(' + closing.dx + 'px, ' + closing.dy + 'px) scale(' + closing.sx + ', ' + closing.sy + ')' } : null,
					},
						headEl,
						React.createElement('iframe', {
							key: reg.token + ':' + reg.version,
							className: 'dsh-pv-frame',
							src: reg.url,
							sandbox: IFRAME_SANDBOX_SERVED,
							title: '页面预览: ' + reg.label,
						}),
					);
				}

				const style = {};
				if (pos !== null) { style.left = pos.left + 'px'; style.top = pos.top + 'px'; style.right = 'auto'; style.bottom = 'auto'; }
				if (size !== null) { style.width = size.w + 'px'; style.height = size.h + 'px'; }
				if (closing !== null) { style.transform = 'translate(' + closing.dx + 'px, ' + closing.dy + 'px) scale(' + closing.sx + ', ' + closing.sy + ')'; }

				let frame = null;
				if (box !== null && box.w > 0 && box.h > 0) {
					const virtualW = Math.max(Math.floor(box.w), VIRTUAL_MIN_WIDTH);
					const scale = box.w / virtualW;
					const iframeH = box.h / scale;
					frame = React.createElement('iframe', {
						key: reg.token + ':' + reg.version,
						className: 'dsh-pv-frame-scaled',
						// +2px oversize (clipped by overflow:hidden) covers sub-pixel
						// rounding so no white hairline shows on the right/bottom.
						style: { width: (virtualW + 2) + 'px', height: (iframeH + 2) + 'px', transform: 'scale(' + scale + ')' },
						src: reg.url,
						sandbox: IFRAME_SANDBOX_SERVED,
						title: '页面预览: ' + reg.label,
					});
				} else {
					frame = React.createElement('iframe', {
						key: reg.token + ':' + reg.version,
						className: 'dsh-pv-frame',
						src: reg.url,
						sandbox: IFRAME_SANDBOX_SERVED,
						title: '页面预览: ' + reg.label,
					});
				}

				return React.createElement('div', {
					className: 'dsh-pv-win' + (closing !== null ? ' dsh-pv-win-closing' : ''),
					style,
					'data-dragging': (move !== null || resize !== null) ? 'true' : 'false',
				},
					headEl,
					React.createElement('div', { className: 'dsh-pv-content', ref: boxRef }, frame),
					React.createElement('div', {
						className: 'dsh-pv-win-resize',
						title: '拖动调整窗口大小',
						onPointerDown: onResizeDown,
						onPointerMove: onResizeMove,
						onPointerUp: onResizeUp,
						onPointerCancel: onResizeUp,
					}),
				);
			}

			function PreviewOverlay(props) {
				if (typeof props.useSessions !== 'function') return null;
				const currentId = props.useSessions((s) => (s && typeof s.current === 'string' ? s.current : null));
				const shared = usePreviewStore();

				React.useEffect(() => {
					let alive = true;
					const tick = async () => {
						const sid = currentId;
						if (sid === null) {
							if (alive) store.set({ sessionId: null, registration: null, closedBySession: {}, lastTokenBySession: {} });
							return;
						}
						let reg = null;
						let regKnown = true;
						try {
							const res = await host.call('state', { sessionId: sid });
							if (!alive) return;
							reg = res && res.registration ? res.registration : null;
						} catch (err) {
							regKnown = false;
						}
						if (!alive) return;
						if (regKnown === false) return;
						const prev = store.get();
						const closedBySession = Object.assign({}, prev.closedBySession);
						const lastTokenBySession = Object.assign({}, prev.lastTokenBySession);
						if (reg !== null) {
							if (lastTokenBySession[sid] !== reg.token) {
								delete closedBySession[sid];
								lastTokenBySession[sid] = reg.token;
							}
						} else {
							delete lastTokenBySession[sid];
						}
						store.set({ sessionId: sid, registration: reg, closedBySession, lastTokenBySession });
					};
					tick();
					const id = window.setInterval(tick, 1000);
					return () => { alive = false; window.clearInterval(id); };
				}, [currentId]);

				const reg = shared.sessionId === currentId ? shared.registration : null;
				const closed = reg !== null && shared.closedBySession[currentId] === true;

				if (reg === null) return null;

				if (!closed) {
					return React.createElement(PreviewWindow, { key: reg.token + ':win', reg, sessionId: currentId });
				}

				const openWindow = () => {
					const closedBySession = Object.assign({}, store.get().closedBySession);
					delete closedBySession[currentId];
					store.set(Object.assign({}, store.get(), { closedBySession }));
				};

				return React.createElement('button', { className: 'dsh-pv-capsule', onClick: openWindow, title: '打开页面预览' },
					React.createElement('span', { className: 'dsh-pv-dot', 'aria-hidden': 'true' }),
					React.createElement('span', { className: 'dsh-pv-cap-label' }, reg.label),
					React.createElement('span', { className: 'dsh-pv-cap-arrow' }, React.createElement(SvgIcon, { d: ICONS.chevronRight })),
				);
			}

			slots.inject('shell.overlay', () => slots.register(
				{ name: 'shell.overlay', id: 'dsh-page-preview.overlay', label: '页面预览' },
				PreviewOverlay,
			));

			slots.inject('conversation.chat.turnTail', () => slots.register(
				{
					name: 'conversation.chat.turnTail',
					priority: -1,
					select: (owner) => ({
						turn: owner && owner.turn && typeof owner.turn.turn === 'number' ? owner.turn : null,
						seq: owner && typeof owner.seq === 'number' ? owner.seq : null,
					}),
				},
				TurnTailExtras,
			));
		}

		const module = { exports: {} };
		module.exports.apply = apply;
		module.exports.name = "dsh-page-preview";
		module.exports.inject = ["slots", "connection"];
		return module.exports;
	}
});
