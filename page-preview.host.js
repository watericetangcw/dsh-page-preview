// dsh-page-preview — Host half FINAL (function body returned as a Cordis Plugin)
// Session-scoped preview registry, 4 model tools, package RPC,
// static file serving for local HTML projects, snippet serving for inline previews.

const FS_ROUTE = '/dsh-page-preview/fs'
const SNIPPET_ROUTE = '/dsh-page-preview/snippet'
const MAX_SNIPPETS = 50
const MAX_SNIPPET_BYTES = 2 * 1024 * 1024
const MAX_ASSET_BYTES = 32 * 1024 * 1024

const MIME_TYPES = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  svg: 'image/svg+xml; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  wasm: 'application/wasm',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  webm: 'video/webm',
}

function makeToken() {
  const chars = '0123456789abcdef'
  let out = ''
  for (let i = 0; i < 24; i++) out += chars[Math.floor(Math.random() * 16)]
  return out
}

function toPosix(p) { return String(p).replace(/\\/g, '/') }
function isAbsolutePath(p) { return /^\/|^[a-zA-Z]:\//.test(toPosix(p)) }
function join(a, b) {
  const left = toPosix(a).replace(/\/+$/, '')
  const right = toPosix(b).replace(/^\/+/, '')
  return left === '' ? right : left + '/' + right
}
function dirname(p) {
  const s = toPosix(p)
  const i = s.lastIndexOf('/')
  return i <= 0 ? s : s.slice(0, i)
}
function basename(p) {
  const s = toPosix(p)
  const i = s.lastIndexOf('/')
  return i < 0 ? s : s.slice(i + 1)
}
function extname(p) {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i < 0 ? '' : b.slice(i + 1).toLowerCase()
}
// Fold `.`/`..` segments away — the local join() concatenates but never
// normalizes, so a served path must be canonicalized before it can be trusted
// to still sit under rootDir. Without this, decodeURIComponent turning `%2f`
// into a slash smuggles a `..%2f..%2f` segment past the per-segment `..` check
// and join()+read escapes rootDir (fs-sandbox contains writes, NOT reads).
function normalizePosix(p) {
  const s = toPosix(p)
  const absolute = s.charAt(0) === '/'
  const out = []
  for (const seg of s.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') { if (out.length > 0 && out[out.length - 1] !== '..') out.pop(); else if (!absolute) out.push('..') }
    else out.push(seg)
  }
  return (absolute ? '/' : '') + out.join('/')
}
function isWithin(rootDir, child) {
  const root = normalizePosix(rootDir).replace(/\/+$/, '')
  const c = normalizePosix(child)
  return c === root || c.startsWith(root + '/')
}
function isHttpUrl(s) { return /^https?:\/\//i.test(String(s).trim()) }

const PROMPT_GUIDANCE = [
  '## Page preview capabilities (dsh-page-preview)',
  '',
  'You can show pages to the user in two ways.',
  '',
  '1. INLINE preview from generated code: when the user asks you to produce a complete static HTML page (a full document with CSS and JS inlined) AND to display it, output the document in a markdown fence whose info string is `html page-preview`:',
  '',
  '```html page-preview',
  '<!doctype html>',
  '<html><head><style>...</style></head><body>...<script>...</script></body></html>',
  '```',
  '',
  'After the turn completes, the UI turns each such fence into an interactive inline preview below the message (the fence itself also stays a normal code block). Keep CSS and JS fully inline (no external resources) so the preview is self-contained. Use this fence only when you actually want to display the page; use a plain `html` fence for code the user should read as code.',
  '',
  '2. FLOATING preview of a local file or URL (session-scoped, one preview at a time):',
  '- preview_register(target): register a local HTML file or a directory containing index.html (absolute path, or relative to the session cwd), or an http(s) URL (localhost dev servers included). This opens a movable, resizable preview window at the bottom-right and shows the top-right capsule.',
  '- preview_replace(target): switch the registered preview to another file/directory or URL.',
  '- preview_refresh(): reload the preview after you edited files.',
  '- preview_unregister(): remove the registration and close the pane when you are done.',
  '',
  'Use preview_register when the user wants to see a page project live (e.g. after you create an HTML page in the workspace), preview_refresh after edits, preview_replace to switch pages, and preview_unregister when finished.',
].join('\n')

return {
  name: 'dsh-page-preview-host',
  inject: ['fs', 'webServer'],
  apply(ctx) {
    const systemPrompt = ctx.get('systemPrompt')
    const registrations = new Map()
    const snippets = new Map()
    const disposers = []

    const ok = (message) => ({ ok: true, message })
    const fail = (message) => ({ ok: false, message })

    const TOOL_OUTPUT_SCHEMA = {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        message: { type: 'string' },
      },
      additionalProperties: false,
    }
    const TOOL_RENDER = (args, value) => [{ type: 'text', text: String(value && value.message) }]

    function definePreviewTool(name, description, parameters, execute) {
      return harness.defineTool({
        name,
        description,
        parameters,
        output: { schema: TOOL_OUTPUT_SCHEMA, render: TOOL_RENDER },
        execute,
      })
    }

    function callerSession(exec) {
      const agent = exec && exec.agent
      if (!agent || !agent.session || typeof agent.session.id !== 'string') return null
      return agent.session
    }

    async function resolvePath(abs) {
      try {
        const target = await ctx.fs.resolve(abs)
        const info = await ctx.fs.stat(target)
        if (!info) return null
        return { target, info }
      } catch (err) {
        console.error('resolvePath failed for', abs, String(err && err.message ? err.message : err))
        return null
      }
    }

    async function registerForSession(session, target) {
      const value = String(target == null ? '' : target).trim()
      if (value === '') return fail('请提供要预览的目标：本地 HTML 文件/目录路径，或 http(s) 网址。')
      if (isHttpUrl(value)) {
        const reg = {
          kind: 'url',
          target: value,
          label: value,
          url: value,
          token: makeToken(),
          version: 1,
          createdAt: Date.now(),
        }
        registrations.set(session.id, reg)
        return ok('已注册网址预览: ' + value + '。右下角预览小窗已打开；可用 preview_refresh 刷新、preview_replace 替换、preview_unregister 解除。')
      }
      if (/^file:/i.test(value)) {
        return fail('file:// 地址无法在浏览器内直接预览。请注册包含 index.html 的工程目录或某个 HTML 文件的路径，插件会通过本机 HTTP 服务代理展示。')
      }
      const cwd = session.header && session.header.cwd ? session.header.cwd : ''
      const abs = toPosix(isAbsolutePath(value) ? value : join(cwd, value))
      const probe = await resolvePath(abs)
      if (probe === null) return fail('路径不存在或不可访问: ' + abs)
      let rootDir
      let entryFile
      if (probe.info.type === 'directory') {
        const idx = await resolvePath(join(abs, 'index.html'))
        if (idx === null || idx.info.type !== 'file') {
          return fail('目录 ' + abs + ' 中没有 index.html。请先创建主页文件，或直接注册某个 HTML 文件路径。')
        }
        rootDir = abs
        entryFile = 'index.html'
      } else if (probe.info.type === 'file') {
        const ext = extname(abs)
        if (ext !== 'html' && ext !== 'htm') {
          return fail('注册文件应为 HTML（.html/.htm），当前目标: ' + abs + '。若注册工程目录，请保证其中存在 index.html。')
        }
        rootDir = dirname(abs)
        entryFile = basename(abs)
      } else {
        return fail('目标不是普通文件或目录: ' + abs)
      }
      const token = makeToken()
      const reg = {
        kind: 'path',
        target: abs,
        label: abs,
        rootDir,
        entryFile,
        url: FS_ROUTE + '/' + token + '/',
        token,
        version: 1,
        createdAt: Date.now(),
      }
      registrations.set(session.id, reg)
      return ok('已注册本地页面: ' + abs + '（服务地址 ' + reg.url + '）。右下角预览小窗已打开；修改文件后可用 preview_refresh 刷新。')
    }

    // ---------------------------------------------------------------- tools

    disposers.push(harness.registerTool(ctx, definePreviewTool(
      'preview_register',
      'Register one page preview for the current session: a local HTML file or a directory containing index.html (absolute path, or relative to the session cwd), or an http(s) URL (localhost dev servers included). Opens the right split preview pane and shows the top-right capsule. Any previous registration of this session is replaced.',
      {
        target: {
          type: 'string',
          description: 'Absolute or session-cwd-relative path to an HTML file/directory, or an http(s) URL.',
          required: true,
        },
      },
      async (args, exec) => {
        const session = callerSession(exec)
        if (session === null) return fail('无法确定调用方的会话，预览注册未执行。')
        return registerForSession(session, args.target)
      },
    )))

    disposers.push(harness.registerTool(ctx, definePreviewTool(
      'preview_replace',
      "Replace the current session's registered preview with another local HTML file/directory or http(s) URL. Fails when this session has no registration yet (use preview_register first).",
      {
        target: {
          type: 'string',
          description: 'New absolute/relative path or http(s) URL to preview.',
          required: true,
        },
      },
      async (args, exec) => {
        const session = callerSession(exec)
        if (session === null) return fail('无法确定调用方的会话。')
        if (!registrations.has(session.id)) return fail('当前会话还没有注册的预览，请先调用 preview_register。')
        return registerForSession(session, args.target)
      },
    )))

    disposers.push(harness.registerTool(ctx, definePreviewTool(
      'preview_refresh',
      "Reload the current session's preview pane (e.g. after the agent edited the page files). Fails when nothing is registered.",
      {},
      async (args, exec) => {
        const session = callerSession(exec)
        if (session === null) return fail('无法确定调用方的会话。')
        const reg = registrations.get(session.id)
        if (!reg) return fail('当前会话没有注册的预览，无法刷新。')
        reg.version += 1
        return ok('已刷新预览: ' + reg.label)
      },
    )))

    disposers.push(harness.registerTool(ctx, definePreviewTool(
      'preview_unregister',
      "Remove the current session's preview registration: the right pane closes and the top-right capsule disappears.",
      {},
      async (args, exec) => {
        const session = callerSession(exec)
        if (session === null) return fail('无法确定调用方的会话。')
        if (!registrations.has(session.id)) return fail('当前会话没有注册的预览。')
        registrations.delete(session.id)
        return ok('已解除预览注册，预览小窗与胶囊已关闭。')
      },
    )))

    // ------------------------------------------------------------- rpc

    disposers.push(harness.handle('preview/state', async (args) => {
      const sid = args && args.sessionId
      const reg = typeof sid === 'string' ? registrations.get(sid) : undefined
      if (!reg) return { registration: null }
      return {
        registration: {
          kind: reg.kind,
          target: reg.target,
          label: reg.label,
          url: reg.url,
          token: reg.token,
          version: reg.version,
        },
      }
    }))

    disposers.push(harness.handle('preview/refresh', async (args) => {
      const sid = args && args.sessionId
      const reg = typeof sid === 'string' ? registrations.get(sid) : undefined
      if (!reg) return { ok: false }
      reg.version += 1
      return { ok: true, version: reg.version }
    }))

    disposers.push(harness.handle('preview/snippet-save', async (args) => {
      const html = args && args.html
      if (typeof html !== 'string' || html.length === 0) return { ok: false, reason: 'empty' }
      if (html.length > MAX_SNIPPET_BYTES) return { ok: false, reason: 'too-large' }
      const id = makeToken()
      snippets.set(id, { html, createdAt: Date.now() })
      while (snippets.size > MAX_SNIPPETS) {
        const firstKey = snippets.keys().next().value
        snippets.delete(firstKey)
      }
      return { ok: true, url: SNIPPET_ROUTE + '/' + id }
    }))

    // ----------------------------------------------------------- routes

    function sendText(res, status, body, contentType) {
      res.statusCode = status
      res.setHeader('Content-Type', contentType || 'text/plain; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(body)
    }

    function parseRoutePath(req, route) {
      const raw = String(req.url || '/')
      const q = raw.indexOf('?')
      const pathname = q < 0 ? raw : raw.slice(0, q)
      if (pathname === route) return []
      if (!pathname.startsWith(route + '/')) return null
      const rest = pathname.slice(route.length + 1)
      const parts = []
      for (const rawSeg of rest.split('/')) {
        if (rawSeg === '') continue
        let seg
        try { seg = decodeURIComponent(rawSeg) } catch (e) { return null }
        if (seg === '..' || seg === '.' || seg.indexOf('\\') >= 0 || seg.indexOf('\0') >= 0) return null
        parts.push(seg)
      }
      return parts
    }

    disposers.push(ctx.webServer.register({
      kind: 'prefix',
      path: FS_ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method Not Allowed')
        const parts = parseRoutePath(req, FS_ROUTE)
        if (parts === null || parts.length === 0) return sendText(res, 404, 'Not found')
        const token = parts[0]
        let reg = null
        for (const r of registrations.values()) {
          if (r.kind === 'path' && r.token === token) { reg = r; break }
        }
        if (reg === null) return sendText(res, 404, 'Unknown preview token')
        const rel = parts.slice(1).join('/')
        const filePath = (rel === '' || rel === reg.entryFile) ? join(reg.rootDir, reg.entryFile) : join(reg.rootDir, rel)
        // Final containment gate: the per-segment `..` filter above is not
        // enough (decoded `%2f` smuggles slashes into one segment), so refuse
        // any resolved path that escapes the registered rootDir.
        if (!isWithin(reg.rootDir, filePath)) return sendText(res, 404, 'Not found')
        let probe = null
        try { probe = await resolvePath(filePath) } catch (err) { console.error('preview fs error:', String(err && err.message ? err.message : err)) }
        if (probe === null || probe.info.type !== 'file') return sendText(res, 404, 'Not found: ' + filePath)
        const mime = MIME_TYPES[extname(filePath)] || 'application/octet-stream'
        res.statusCode = 200
        res.setHeader('Content-Type', mime)
        res.setHeader('Cache-Control', 'no-store')
        if (req.method === 'HEAD') return res.end()
        const isText = mime.indexOf('text/') === 0 || mime.indexOf('json') >= 0 || mime.indexOf('javascript') >= 0 || mime.indexOf('xml') >= 0 || mime.indexOf('svg') >= 0
        if (probe.info.size === undefined || probe.info.size <= MAX_ASSET_BYTES) {
          try {
            const bytes = await ctx.fs.readBytes(probe.target, undefined, MAX_ASSET_BYTES)
            res.end(bytes)
            return
          } catch (err) { console.error('readBytes failed:', String(err && err.message ? err.message : err)) }
        }
        if (isText) {
          try {
            for await (const chunk of ctx.fs.streamText(probe.target, undefined)) res.write(chunk)
            res.end()
            return
          } catch (err) { console.error('streamText failed:', String(err && err.message ? err.message : err)) }
        }
        return sendText(res, 413, 'Asset too large')
      },
    }))

    disposers.push(ctx.webServer.register({
      kind: 'prefix',
      path: SNIPPET_ROUTE,
      handler: async (req, res) => {
        const parts = parseRoutePath(req, SNIPPET_ROUTE)
        const entry = parts && parts.length >= 1 ? snippets.get(parts[0]) : undefined
        if (!entry) return sendText(res, 404, 'Unknown snippet')
        return sendText(res, 200, entry.html, 'text/html; charset=utf-8')
      },
    }))

    // ----------------------------------------------------- lifecycle

    disposers.push(ctx.on('session/disposed', (session) => {
      try {
        const sid = session && session.id
        if (typeof sid === 'string' && registrations.has(sid)) registrations.delete(sid)
      } catch (err) { console.error('session/disposed cleanup failed:', String(err && err.message ? err.message : err)) }
    }))

    if (systemPrompt && typeof systemPrompt.section === 'function') {
      try {
        disposers.push(systemPrompt.section({ name: 'dsh-page-preview-usage', order: 110, text: PROMPT_GUIDANCE }))
      } catch (err) { console.error('systemPrompt section failed:', String(err && err.message ? err.message : err)) }
    }

    ctx.effect(() => () => {
      for (const d of disposers) {
        try { if (typeof d === 'function') d() } catch (err) { /* ignore */ }
      }
    })

    console.log('dsh-page-preview host ready: tools preview_register / preview_replace / preview_refresh / preview_unregister; routes', FS_ROUTE, SNIPPET_ROUTE)
  },
}
