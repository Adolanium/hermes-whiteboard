/**
 * Static checks for a Hermes disk plugin, run before syncing.
 *
 *   node check.mjs [path/to/plugin.js]    (default: desktop/plugin.js)
 *
 * A disk plugin has no build and no typechecker, so these are the only things
 * standing between a typo and a broken pane. Each rule exists because it
 * actually bit us:
 *
 *  - a bare specifier anywhere in the source (comments included) fails the load
 *  - a component used in jsx() but not imported is a ReferenceError at render
 *  - an icons.X that the app doesn't export renders as undefined
 *  - a hardcoded color survives a theme switch and looks broken
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// The icon set must match the Hermes the plugin actually runs in, so default to
// the installed app's source: HERMES_HOME, else the Windows default home, else
// ~/.hermes. HERMES_DESKTOP_SRC overrides all of them.
const hermesHome =
  process.env.HERMES_HOME ||
  (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'hermes') : path.join(process.env.HOME ?? '.', '.hermes'))

const APP = process.env.HERMES_DESKTOP_SRC ?? path.join(hermesHome, 'hermes-agent/apps/desktop/src')
const file = process.argv[2] ?? 'desktop/plugin.js'
const src = fs.readFileSync(file, 'utf8')

const problems = []
const note = (label, detail) => problems.push(`${label}: ${detail}`)

// 0. Size. Hermes Desktop reads a plugin.js of up to 16 MiB in full (since
// 0.21.6; Whiteboard needs 0.22.6). Shells older than that stopped at 512 KiB.
const PLUGIN_MAX_BYTES = 16 * 1024 * 1024
const bytes = Buffer.byteLength(src, 'utf8')

if (bytes > PLUGIN_MAX_BYTES) {
  note('size', `${bytes} bytes is over the 16 MiB Hermes Desktop reads`)
}

// 1. Syntax - the loader gives a cryptic blob error, so catch it here.
const tmp = path.join(os.tmpdir(), 'whiteboard-syntax-check.mjs')
fs.writeFileSync(tmp, src)

try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' })
} catch (error) {
  note('syntax', String(error.stderr ?? error).split('\n').slice(0, 4).join(' '))
}

// 2. Import specifiers. The loader's own regex, applied to the whole file.
const ALLOWED = new Set(['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'])
const specifiers = [...src.matchAll(/(from\s*|import\s*\(\s*|import\s+)(['"])([^'"]+)\2/g)].map(m => m[3])
const bare = specifiers.filter(
  s => !ALLOWED.has(s) && !/^[./]/.test(s) && !/^[a-z][a-z0-9+.-]*:/i.test(s)
)

if (bare.length) {
  note('unsupported import', [...new Set(bare)].join(', '))
}

// 3. Components used in jsx() must be imported or defined locally.
const imported = new Set()

for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
  for (const part of m[1].split(',')) {
    const name = part.trim().split(/\s+as\s+/).pop()

    if (name) {
      imported.add(name)
    }
  }
}

const local = new Set([...src.matchAll(/^(?:function|const)\s+([A-Z][A-Za-z0-9_]*)/gm)].map(m => m[1]))
const usedComponents = new Set([...src.matchAll(/jsxs?\(\s*([A-Z][A-Za-z0-9_]*)/g)].map(m => m[1]))
const undeclared = [...usedComponents].filter(n => !imported.has(n) && !local.has(n))

if (undeclared.length) {
  note('component not imported', undeclared.join(', '))
}

// 4. Every icons.X must exist in the app's icon module.
const iconSource = fs.readFileSync(path.join(APP, 'lib/icons.ts'), 'utf8')
const iconsUsed = [...new Set([...src.matchAll(/icons\.([A-Z][A-Za-z0-9]*)/g)].map(m => m[1]))]
const missingIcons = iconsUsed.filter(name => !new RegExp(`^\\s+${name}\\b`, 'm').test(iconSource))

if (missingIcons.length) {
  note('icon not in app set', missingIcons.join(', '))
}

// 5. Gateway RPCs resolve to a RESULT OBJECT, never a bare string. Assigning
//    `llm.oneshot` straight to something named like text and stringifying it
//    yields "[object Object]", which is invisible to any length or type check
//    and renders as a real-looking value. This shipped once.
for (const m of src.matchAll(/const\s+(\w+)\s*=\s*await host\.request\(\s*'([\w.]+)'/g)) {
  const [, binding, method] = m
  const after = src.slice(m.index, m.index + 1600)

  if (/^(text|answer|reply|result|out|value)$/.test(binding) && !after.includes(`${binding}?.text`)) {
    note('rpc result used raw', `${binding} = await host.request('${method}') - did you mean ${binding}?.text`)
  }
}

// 6. No literal colors - they survive a theme switch and look broken.
const colors = src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []

if (colors.length) {
  note('hardcoded color', [...new Set(colors)].join(', '))
}

// 7. A duplicated top-level definition means a bad splice.
const counts = {}

for (const m of src.matchAll(/^function\s+([A-Za-z0-9_]+)/gm)) {
  counts[m[1]] = (counts[m[1]] ?? 0) + 1
}

const dupes = Object.entries(counts).filter(([, n]) => n > 1).map(([n]) => n)

if (dupes.length) {
  note('defined twice', dupes.join(', '))
}

// 8. Imports that nothing uses (dead weight after a refactor).
const body = src.slice(src.indexOf("from 'react/jsx-runtime'") + 24)
const unused = [...imported].filter(name => !new RegExp(`\\b${name}\\b`).test(body))

if (unused.length) {
  note('imported but unused', unused.join(', '))
}

console.log(`${file} - ${src.split('\n').length} lines, ${iconsUsed.length} icons, ${imported.size} SDK imports`)

if (problems.length === 0) {
  console.log('all checks passed')
  process.exit(0)
}

for (const problem of problems) {
  console.log(`  FAIL  ${problem}`)
}

process.exit(1)
