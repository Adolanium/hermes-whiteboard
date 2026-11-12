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
      t: (key, ...args) => typeof context.__i18n.MESSAGES[locale][key] === 'function'
        ? context.__i18n.MESSAGES[locale][key](...args)
        : (context.__i18n.MESSAGES[locale][key] ?? context.__i18n.MESSAGES.en[key] ?? key)
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
