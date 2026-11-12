import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const SOURCE = fs.readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')

/** Load the plugin with a fake `ctx` and a fake `ctx.i18n` that resolves keys
 *  the way the app does: active locale → this plugin's English → the key. */
function load(locale) {
  const source = SOURCE.replace(/import\s*\{[^}]+\}\s*from '@hermes\/plugin-sdk'\r?\n/, '')
    .replace(/import\s*\{[^}]+\}\s*from 'react'\r?\n/, '')
    .replace(/import\s*\{[^}]+\}\s*from 'react\/jsx-runtime'\r?\n/, '')
    .replace('export default {', 'globalThis.plugin = {')
    .concat(`
      globalThis.__i18n = { MESSAGES, translate: (key, ...args) => tr(key, ...args) }
    `)

  const atom = initial => {
    let value = initial

    return { get: () => value, set: next => { value = next } }
  }
  const context = {
    atom,
    clearTimeout: () => undefined,
    console,
    host: { navigate: () => undefined, notify: () => undefined, onEvent: () => () => undefined, request: async () => ({}) },
    icons: {},
    jsx: () => null,
    jsxs: () => null,
    Math,
    Object,
    PALETTE_AREA: 'palette',
    ROUTES_AREA: 'routes',
    SIDEBAR_NAV_AREA: 'sidebarNav',
    setTimeout: () => 1
  }

  context.globalThis = context
  vm.runInNewContext(source, context, { filename: 'desktop/plugin.js' })

  const registrations = []
  let bundles = null
  const ctx = {
    i18n: {
      register: value => {
        bundles = value

        return () => undefined
      },
      // The same lookup Hermes does (apps/desktop/src/i18n/runtime.ts): walk the key as a
      // dot-path into the registered tree, active locale first, then English, then the key.
      t: (key, ...args) => {
        const walk = tree => key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), tree)

        for (const tree of [bundles?.[locale], bundles?.en]) {
          const value = walk(tree)

          if (typeof value === 'string') {
            return value
          }

          if (typeof value === 'function') {
            return value(...args)
          }
        }

        return key
      }
    },
    onDispose: () => undefined,
    registerMany: list => {
      registrations.push(...list)

      return () => undefined
    },
    i18nOnLocaleChange: () => () => undefined,
    storage: { get: (key, fallback) => fallback, remove: () => undefined, set: () => undefined }
  }

  context.plugin.register(ctx)

  return { bundles, registrations, translate: context.__i18n.translate }
}

const labelOf = (registrations, id) => registrations.find(entry => entry.id === id)

test('the plugin hands both locales to the app and the sidebar follows it', () => {
  for (const [locale, expected] of [['en', 'Whiteboard'], ['zh', '白板']]) {
    const { bundles, registrations } = load(locale)

    assert.ok(bundles, 'the bundles reach ctx.i18n.register')
    assert.deepEqual(Object.keys(bundles).sort(), ['en', 'zh'])
    assert.equal(labelOf(registrations, 'nav').data.label, expected)
    assert.equal(labelOf(registrations, 'page').title, expected)
  }
})

test('the palette command and the app description are translated too', () => {
  const zh = load('zh')
  const en = load('en')

  assert.equal(labelOf(zh.registrations, 'open').data.label, '打开白板')
  assert.equal(labelOf(en.registrations, 'open').data.label, 'Open Whiteboard')
})

test('every English key has a Chinese one, and neither bundle carries a stray key', () => {
  const { bundles } = load('en')
  const en = Object.keys(bundles.en).sort()
  const zh = Object.keys(bundles.zh).sort()

  assert.deepEqual(zh, en)
})

test('a formatted message keeps its arguments in the same order', () => {
  const { translate } = load('en')

  assert.equal(translate('compose.askThese', 3), 'Ask Hermes about these 3 items')
  assert.equal(translate('compose.askThis'), 'Ask Hermes about this')
})

test('every component that looks up copy asks for the translator first', () => {
  const source = fs.readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
  const lines = source.split('\n')
  const starts = lines.flatMap((line, index) => (/^(async )?function \w+/.test(line) ? [index] : []))
  const missing = []

  starts.forEach((start, at) => {
    const body = lines.slice(start, starts[at + 1] ?? lines.length).join('\n')
    const uses = /(?<![\w.$])t\((['`]|LAYOUT_META|TONES)/.test(body)

    if (uses && !body.includes("const t = usePluginI18n('whiteboard')")) {
      missing.push(lines[start].slice(0, 50))
    }
  })

  // A component that calls t() without it throws "t is not defined" when the page renders.
  assert.deepEqual(missing, [])
})

test('every key resolves through the nested lookup Hermes uses, in both languages', () => {
  for (const locale of ['en', 'zh']) {
    const { translate } = load(locale)
    const source = fs.readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
    const flat = source.slice(source.indexOf('const MESSAGES = {'), source.indexOf('function messageTree'))
    const keys = [...new Set([...flat.matchAll(/^\s+'?([A-Za-z][\w.]*)'?: /gm)].map(match => match[1]))].filter(key => !['en', 'zh'].includes(key))

    assert.equal(keys.length > 50, true)

    for (const key of keys) {
      // A key that came back as itself was not found in the tree.
      assert.notEqual(translate(key, 3), key, `${locale}: ${key}`)
    }
  }

  assert.equal(load('zh').translate('layoutHint.route'), '按顺序排成一条路，像上线计划或行程')
  assert.equal(load('zh').translate('compose.askThese', 4), '就这 4 条问 Hermes')
})
