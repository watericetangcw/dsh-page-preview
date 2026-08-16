// dsh-page-preview — host half (real DSH plugin, permanent install)
// Session-scoped preview registry, 4 model tools, client RPC over the
// "connection" service, static file serving for local HTML projects,
// and snippet serving for inline previews.
import { defineTool } from "@deepseek-ai/dsh-tools";

/** Stable Cordis plugin name used by Loader diagnostics. */
export const name = "dsh-page-preview";

/** Services required before this plugin activates. */
export const inject = ["fs", "webServer", "tools"];

const RPC_CHANNEL = "/dsh-page-preview";
const FS_ROUTE = "/dsh-page-preview/fs";
const SNIPPET_ROUTE = "/dsh-page-preview/snippet";
const MAX_SNIPPETS = 50;
const MAX_SNIPPET_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;

const MIME_TYPES = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  svg: "image/svg+xml; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  webm: "video/webm",
};

function makeToken() {
  const chars = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 24; i++) out += chars[Math.floor(Math.random() * 16)];
  return out;
}

function toPosix(p) { return String(p).replace(/\\/g, "/"); }
function isAbsolutePath(p) { return /^\/|^[a-zA-Z]:\//.test(toPosix(p)); }
function join(a, b) {
  const left = toPosix(a).replace(/\/+$/, "");
  const right = toPosix(b).replace(/^\/+/, "");
  return left === "" ? right : left + "/" + right;
}
function dirname(p) {
  const s = toPosix(p);
  const i = s.lastIndexOf("/");
  return i <= 0 ? s : s.slice(0, i);
}
function basename(p) {
  const s = toPosix(p);
  const i = s.lastIndexOf("/");
  return i < 0 ? s : s.slice(i + 1);
}
function extname(p) {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i < 0 ? "" : b.slice(i + 1).toLowerCase();
}
function isHttpUrl(s) { return /^https?:\/\//i.test(String(s).trim()); }

const PROMPT_GUIDANCE = [
  "## Page preview capabilities (dsh-page-preview)",
  "",
  "You can show pages to the user in two ways.",
  "",
  "1. INLINE preview from generated code: when the user asks you to produce a complete static HTML page (a full document with CSS and JS inlined) AND to display it, output the document in a markdown fence whose info string is `html page-preview`:",
  "",
  "```html page-preview",
  "<!doctype html>",
  "<html><head><style>...</style></head><body>...<script>...</script></body></html>",
  "```",
  "",
  "After the turn completes, the UI turns each such fence into an interactive inline preview below the message (the fence itself also stays a normal code block). Keep CSS and JS fully inline (no external resources) so the preview is self-contained. Use this fence only when you actually want to display the page; use a plain `html` fence for code the user should read as code.",
  "",
  "2. FLOATING preview of a local file or URL (session-scoped, one preview at a time):",
  "- preview_register(target): register a local HTML file or a directory containing index.html (absolute path, or relative to the session cwd), or an http(s) URL (localhost dev servers included). This opens a movable, resizable preview window at the bottom-right and shows the top-right capsule.",
  "- preview_replace(target): switch the registered preview to another file/directory or URL.",
  "- preview_refresh(): reload the preview after you edited files.",
  "- preview_unregister(): remove the registration and close the pane when you are done.",
  "",
  "Use preview_register when the user wants to see a page project live (e.g. after you create an HTML page in the workspace), preview_refresh after edits, preview_replace to switch pages, and preview_unregister when finished.",
].join("\n");

/**
 * Host plugin body: session-scoped registrations, four model tools, the
 * client RPC channel, and the static/snippet HTTP routes.
 * @param ctx - host context (process-global registries: tools, webServer, fs)
 */
export function apply(ctx) {
  const registrations = new Map();
  const snippets = new Map();

  const ok = (message) => ({ ok: true, message });
  const fail = (message) => ({ ok: false, message });

  const TOOL_OUTPUT_SCHEMA = {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      message: { type: "string" },
    },
    additionalProperties: false,
  };
  const TOOL_RENDER = (_args, value) => [{ type: "text", text: String(value && value.message) }];

  function definePreviewTool(name, description, parameters, execute) {
    return defineTool({
      name,
      description,
      parameters,
      output: { schema: TOOL_OUTPUT_SCHEMA, render: TOOL_RENDER },
      execute,
    });
  }

  function callerSession(exec) {
    const agent = exec && exec.agent;
    if (!agent || !agent.session || typeof agent.session.id !== "string") return null;
    return agent.session;
  }

  async function resolvePath(abs) {
    try {
      const target = await ctx.fs.resolve(abs);
      const info = await ctx.fs.stat(target);
      if (!info) return null;
      return { target, info };
    } catch (err) {
      console.error("dsh-page-preview: resolvePath failed for", abs, String(err && err.message ? err.message : err));
      return null;
    }
  }

  async function registerForSession(session, target) {
    const value = String(target == null ? "" : target).trim();
    if (value === "") return fail("请提供要预览的目标：本地 HTML 文件/目录路径，或 http(s) 网址。");
    if (isHttpUrl(value)) {
      const reg = {
        kind: "url",
        target: value,
        label: value,
        url: value,
        token: makeToken(),
        version: 1,
        createdAt: Date.now(),
      };
      registrations.set(session.id, reg);
      return ok("已注册网址预览: " + value + "。右下角预览小窗已打开；可用 preview_refresh 刷新、preview_replace 替换、preview_unregister 解除。");
    }
    if (/^file:/i.test(value)) {
      return fail("file:// 地址无法在浏览器内直接预览。请注册包含 index.html 的工程目录或某个 HTML 文件的路径，插件会通过本机 HTTP 服务代理展示。");
    }
    const cwd = session.header && session.header.cwd ? session.header.cwd : "";
    const abs = toPosix(isAbsolutePath(value) ? value : join(cwd, value));
    const probe = await resolvePath(abs);
    if (probe === null) return fail("路径不存在或不可访问: " + abs);
    let rootDir;
    let entryFile;
    if (probe.info.type === "directory") {
      const idx = await resolvePath(join(abs, "index.html"));
      if (idx === null || idx.info.type !== "file") {
        return fail("目录 " + abs + " 中没有 index.html。请先创建主页文件，或直接注册某个 HTML 文件路径。");
      }
      rootDir = abs;
      entryFile = "index.html";
    } else if (probe.info.type === "file") {
      const ext = extname(abs);
      if (ext !== "html" && ext !== "htm") {
        return fail("注册文件应为 HTML（.html/.htm），当前目标: " + abs + "。若注册工程目录，请保证其中存在 index.html。");
      }
      rootDir = dirname(abs);
      entryFile = basename(abs);
    } else {
      return fail("目标不是普通文件或目录: " + abs);
    }
    const token = makeToken();
    const reg = {
      kind: "path",
      target: abs,
      label: abs,
      rootDir,
      entryFile,
      url: FS_ROUTE + "/" + token + "/",
      token,
      version: 1,
      createdAt: Date.now(),
    };
    registrations.set(session.id, reg);
    return ok("已注册本地页面: " + abs + "（服务地址 " + reg.url + "）。右下角预览小窗已打开；修改文件后可用 preview_refresh 刷新。");
  }

  // ---------------------------------------------------------------- tools

  ctx.tools.register(definePreviewTool(
    "preview_register",
    "Register one page preview for the current session: a local HTML file or a directory containing index.html (absolute path, or relative to the session cwd), or an http(s) URL (localhost dev servers included). Opens a movable, resizable floating preview window at the bottom-right and shows the top-right capsule. Any previous registration of this session is replaced.",
    {
      target: {
        type: "string",
        description: "Absolute or session-cwd-relative path to an HTML file/directory, or an http(s) URL.",
        required: true,
      },
    },
    async (args, exec) => {
      const session = callerSession(exec);
      if (session === null) return fail("无法确定调用方的会话，预览注册未执行。");
      return registerForSession(session, args.target);
    },
  ));

  ctx.tools.register(definePreviewTool(
    "preview_replace",
    "Replace the current session's registered preview with another local HTML file/directory or http(s) URL. Fails when this session has no registration yet (use preview_register first).",
    {
      target: {
        type: "string",
        description: "New absolute/relative path or http(s) URL to preview.",
        required: true,
      },
    },
    async (args, exec) => {
      const session = callerSession(exec);
      if (session === null) return fail("无法确定调用方的会话。");
      if (!registrations.has(session.id)) return fail("当前会话还没有注册的预览，请先调用 preview_register。");
      return registerForSession(session, args.target);
    },
  ));

  ctx.tools.register(definePreviewTool(
    "preview_refresh",
    "Reload the current session's preview window (e.g. after the agent edited the page files). Fails when nothing is registered.",
    {},
    async (_args, exec) => {
      const session = callerSession(exec);
      if (session === null) return fail("无法确定调用方的会话。");
      const reg = registrations.get(session.id);
      if (!reg) return fail("当前会话没有注册的预览，无法刷新。");
      reg.version += 1;
      return ok("已刷新预览: " + reg.label);
    },
  ));

  ctx.tools.register(definePreviewTool(
    "preview_unregister",
    "Remove the current session's preview registration: the floating window closes and the top-right capsule disappears.",
    {},
    async (_args, exec) => {
      const session = callerSession(exec);
      if (session === null) return fail("无法确定调用方的会话。");
      if (!registrations.has(session.id)) return fail("当前会话没有注册的预览。");
      registrations.delete(session.id);
      return ok("已解除预览注册，预览小窗与胶囊已关闭。");
    },
  ));

  // ------------------------------------------------------------- rpc

  async function handleRpc(endpoint, payload) {
    // The connection RPC protocol wraps every result:
    //   { ok: true, value } | { ok: false, error: { code, message, details } }
    // with "internal" as the only generic error code.
    const rpcError = (message) => ({ ok: false, error: { code: "internal", message, details: {} } });
    if (endpoint === "state") {
      const sid = payload && payload.sessionId;
      const reg = typeof sid === "string" ? registrations.get(sid) : undefined;
      if (!reg) return { ok: true, value: { registration: null } };
      return {
        ok: true,
        value: {
          registration: {
            kind: reg.kind,
            target: reg.target,
            label: reg.label,
            url: reg.url,
            token: reg.token,
            version: reg.version,
          },
        },
      };
    }
    if (endpoint === "refresh") {
      const sid = payload && payload.sessionId;
      const reg = typeof sid === "string" ? registrations.get(sid) : undefined;
      if (!reg) return rpcError("no preview registration for this session");
      reg.version += 1;
      return { ok: true, value: { ok: true, version: reg.version } };
    }
    if (endpoint === "snippet-save") {
      const html = payload && payload.html;
      if (typeof html !== "string" || html.length === 0) return rpcError("empty snippet");
      if (html.length > MAX_SNIPPET_BYTES) return rpcError("snippet too large");
      const id = makeToken();
      snippets.set(id, { html, createdAt: Date.now() });
      while (snippets.size > MAX_SNIPPETS) {
        const firstKey = snippets.keys().next().value;
        snippets.delete(firstKey);
      }
      return { ok: true, value: { ok: true, url: SNIPPET_ROUTE + "/" + id } };
    }
    return rpcError("unknown endpoint: " + String(endpoint));
  }

  ctx.inject(["connection"], (connCtx) => {
    connCtx.effect(
      () => connCtx.connection.rpc.handle(RPC_CHANNEL, handleRpc, {}),
      "dsh-page-preview: rpc channel",
    );
  });

  // ----------------------------------------------------------- routes

  function sendText(res, status, body, contentType) {
    res.statusCode = status;
    res.setHeader("Content-Type", contentType || "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(body);
  }

  function parseRoutePath(req, route) {
    const raw = String(req.url || "/");
    const q = raw.indexOf("?");
    const pathname = q < 0 ? raw : raw.slice(0, q);
    if (pathname === route) return [];
    if (!pathname.startsWith(route + "/")) return null;
    const rest = pathname.slice(route.length + 1);
    const parts = [];
    for (const rawSeg of rest.split("/")) {
      if (rawSeg === "") continue;
      let seg;
      try { seg = decodeURIComponent(rawSeg); } catch (e) { return null; }
      if (seg === ".." || seg === "." || seg.indexOf("\\") >= 0 || seg.indexOf("\0") >= 0) return null;
      parts.push(seg);
    }
    return parts;
  }

  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: FS_ROUTE,
    handler: async (req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") return sendText(res, 405, "Method Not Allowed");
      const parts = parseRoutePath(req, FS_ROUTE);
      if (parts === null || parts.length === 0) return sendText(res, 404, "Not found");
      const token = parts[0];
      let reg = null;
      for (const r of registrations.values()) {
        if (r.kind === "path" && r.token === token) { reg = r; break; }
      }
      if (reg === null) return sendText(res, 404, "Unknown preview token");
      const rel = parts.slice(1).join("/");
      const filePath = (rel === "" || rel === reg.entryFile) ? join(reg.rootDir, reg.entryFile) : join(reg.rootDir, rel);
      let probe = null;
      try { probe = await resolvePath(filePath); } catch (err) { console.error("dsh-page-preview: fs error:", String(err && err.message ? err.message : err)); }
      if (probe === null || probe.info.type !== "file") return sendText(res, 404, "Not found: " + filePath);
      const mime = MIME_TYPES[extname(filePath)] || "application/octet-stream";
      res.statusCode = 200;
      res.setHeader("Content-Type", mime);
      res.setHeader("Cache-Control", "no-store");
      if (req.method === "HEAD") return res.end();
      const isText = mime.indexOf("text/") === 0 || mime.indexOf("json") >= 0 || mime.indexOf("javascript") >= 0 || mime.indexOf("xml") >= 0 || mime.indexOf("svg") >= 0;
      if (probe.info.size === undefined || probe.info.size <= MAX_ASSET_BYTES) {
        try {
          const bytes = await ctx.fs.readBytes(probe.target, undefined, MAX_ASSET_BYTES);
          res.end(bytes);
          return;
        } catch (err) { console.error("dsh-page-preview: readBytes failed:", String(err && err.message ? err.message : err)); }
      }
      if (isText) {
        try {
          for await (const chunk of ctx.fs.streamText(probe.target, undefined)) res.write(chunk);
          res.end();
          return;
        } catch (err) { console.error("dsh-page-preview: streamText failed:", String(err && err.message ? err.message : err)); }
      }
      return sendText(res, 413, "Asset too large");
    },
  }), "dsh-page-preview: fs route");

  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: SNIPPET_ROUTE,
    handler: async (req, res) => {
      const parts = parseRoutePath(req, SNIPPET_ROUTE);
      const entry = parts && parts.length >= 1 ? snippets.get(parts[0]) : undefined;
      if (!entry) return sendText(res, 404, "Unknown snippet");
      return sendText(res, 200, entry.html, "text/html; charset=utf-8");
    },
  }), "dsh-page-preview: snippet route");

  // ----------------------------------------------------- lifecycle

  ctx.on("session/disposed", (session) => {
    try {
      const sid = session && session.id;
      if (typeof sid === "string" && registrations.has(sid)) registrations.delete(sid);
    } catch (err) { console.error("dsh-page-preview: session/disposed cleanup failed:", String(err && err.message ? err.message : err)); }
  });

  ctx.inject(["systemPrompt"], (promptCtx) => {
    try {
      promptCtx.systemPrompt.section({ name: "dsh-page-preview-usage", order: 110, text: PROMPT_GUIDANCE });
    } catch (err) { console.error("dsh-page-preview: systemPrompt section failed:", String(err && err.message ? err.message : err)); }
  });

  console.log("dsh-page-preview host ready: tools preview_register / preview_replace / preview_refresh / preview_unregister; routes", FS_ROUTE, SNIPPET_ROUTE);
}
