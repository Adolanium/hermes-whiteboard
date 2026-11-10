import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const SOURCE = fs.readFileSync(new URL('../desktop/plugin.js', import.meta.url), 'utf8')

function load(options = {}) {
  const source = SOURCE.replace(/import\s*\{[^}]+\}\s*from '@hermes\/plugin-sdk'\r?\n/, '')
    .replace(/import\s*\{[^}]+\}\s*from 'react'\r?\n/, '')
    .replace(/import\s*\{[^}]+\}\s*from 'react\/jsx-runtime'\r?\n/, '')
    .replace('export default {', 'globalThis.plugin = {')
    .concat(`
      if (globalThis.__os) pluginOs = globalThis.__os
      if (globalThis.__rest) pluginRest = globalThis.__rest
      if (globalThis.__storage) storage = globalThis.__storage
      globalThis.__wb = {
        $board, $editing, $index, $selection, STICKER_NAMES, applyProposalItem, boardMarkdown, boundsOf, centerOf, decideProposal,
        $tool, liftTitle, routeResultSpot, addArrow, askScope, boardTable, bulletsOf, cloneItems, duplicateSelection, edgePoint, inkFromPoints, openActionCount,
        pathFractions, planStops, removeArrows, resizeItem, suggestedNotes, toDelimited, toggleAction, withChildren,
        emptyBoard, exportBoard, fitFrames, frameSlots, hydrate, inside, lastJsonObject, layoutSpec, makeNote, moveItems,
        overlaps, parseBoardSpec, parseRunReply, rectOf, redo, removeItems, sectionsOf, setBoard, sharedBoardCopy, takeBack,
        takeBackReceipt, takeBackState, tidyProposal, undo, chatProposal
      }
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
    setTimeout: () => 1,
    __os: options.os,
    __rest: options.rest,
    __storage: options.storage
  }

  context.globalThis = context
  vm.runInNewContext(source, context, { filename: 'desktop/plugin.js' })

  return context.__wb
}

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed))

  return {
    get: (key, fallback) => (values.has(key) ? values.get(key) : fallback),
    remove: key => values.delete(key),
    set: (key, value) => values.set(key, value),
    values
  }
}

const SPEC = {
  layout: 'route',
  sections: [
    { label: 'Day 1', notes: [{ text: 'Lock the flavour' }, { action: true, text: 'Compare three bakery suppliers' }], sticker: 'flag', title: 'Kickoff' },
    { notes: ['Price the box'], sticker: 'coins', title: 'Pricing' },
    { notes: [], sticker: 'nope', title: 'Ship it' },
    { title: '' }
  ],
  title: 'Spring bake sale'
}

test('a model board is cleaned to what the page can draw', () => {
  const wb = load()
  const spec = wb.parseBoardSpec(SPEC)

  assert.equal(spec.layout, 'route')
  assert.equal(spec.title, 'Spring bake sale')
  assert.equal(spec.sections.length, 3)
  assert.equal(spec.sections[1].notes[0].text, 'Price the box')
  assert.equal(spec.sections[0].notes[1].action, true)
  assert.equal(spec.sections[2].sticker, undefined)
  assert.equal(wb.parseBoardSpec({ ...SPEC, layout: 'spiral' }).layout, 'columns')
  assert.equal(wb.parseBoardSpec(SPEC, 'map').layout, 'map')
  assert.equal(wb.parseBoardSpec({ sections: [{ title: 'Only one' }] }), null)
  assert.equal(wb.parseBoardSpec(null), null)
})

test('a route lays waypoints along a road without overlapping cards', () => {
  const wb = load()
  const { items, links } = wb.layoutSpec(wb.parseBoardSpec(SPEC), { x: 0, y: 0 })
  const stops = items.filter(item => item.kind === 'waypoint')
  const notes = items.filter(item => item.kind === 'note')

  assert.equal(stops.length, 3)
  assert.equal(links.length, 2)
  assert.deepEqual(Array.from(links, link => [link.from, link.to]), [[stops[0].id, stops[1].id], [stops[1].id, stops[2].id]])
  assert.equal(notes.length, 3)
  assert.ok(notes.every(note => stops.some(stop => stop.id === note.frame)))
  assert.equal(notes.find(note => note.text.startsWith('Compare')).action, true)
  assert.equal(items[0].kind, 'text')
  assert.ok(items[0].y < Math.min(...stops.map(stop => stop.y)))

  for (const a of [...stops, ...notes]) {
    for (const b of [...stops, ...notes]) {
      if (a !== b) {
        assert.equal(wb.overlaps(wb.rectOf(a), wb.rectOf(b)), false, `${a.title || a.text} overlaps ${b.title || b.text}`)
      }
    }
  }
})

test('columns put each section in its own frame, and a map grows around a hub', () => {
  const wb = load()
  const columns = wb.layoutSpec(wb.parseBoardSpec(SPEC, 'columns'), { x: 0, y: 0 })
  const frames = columns.items.filter(item => item.kind === 'frame')

  assert.equal(frames.length, 3)
  assert.ok(frames[0].x + frames[0].w < frames[1].x)

  for (const note of columns.items.filter(item => item.kind === 'note')) {
    const frame = frames.find(entry => entry.id === note.frame)

    assert.ok(wb.inside(wb.centerOf(note), wb.rectOf(frame)))
  }

  const map = wb.layoutSpec(wb.parseBoardSpec(SPEC, 'map'), { x: 0, y: 0 })
  const hub = map.items.find(item => item.kind === 'hub')

  assert.equal(hub.title, 'Spring bake sale')
  assert.equal(map.links.length, 3)
  assert.ok(map.links.every(link => link.kind === 'branch' && link.from === hub.id))
  assert.equal(map.items.some(item => item.kind === 'text'), false)
})

test('the last JSON object wins over prose and earlier JSON', () => {
  const wb = load()

  assert.deepEqual(JSON.parse(JSON.stringify(wb.lastJsonObject('Sure {"a": 1} then {"sections": []}', value => 'sections' in value))), { sections: [] })
  assert.equal(wb.lastJsonObject('no json here'), null)
  assert.equal(wb.lastJsonObject('```json\n{"x": 2}\n```').x, 2)
})

function boardWith(wb, items) {
  return { ...wb.emptyBoard('Retro'), items }
}

test('grouping notes moves them into a new frame, and the receipt takes it back', () => {
  const wb = load()
  const a = wb.makeNote({ id: 'a', text: 'Signup email lands in spam', x: 0, y: 0 })
  const b = wb.makeNote({ id: 'b', text: 'Trial ends with no warning', x: 600, y: 400 })
  const c = wb.makeNote({ id: 'c', text: 'Launch post did well', x: 1200, y: 0 })
  const board = boardWith(wb, [a, b, c])
  const outcome = wb.applyProposalItem(board, { kind: 'group', noteIds: ['a', 'b', 'zz'], title: 'Onboarding' })
  const frame = outcome.board.items.find(item => item.kind === 'frame')
  const moved = outcome.board.items.filter(item => item.frame === frame.id)

  assert.equal(frame.title, 'Onboarding')
  assert.equal(moved.length, 2)
  assert.ok(moved.every(note => wb.inside(wb.centerOf(note), wb.rectOf(frame))))
  assert.equal(outcome.board.items.find(item => item.id === 'c').x, 1200)
  assert.equal(wb.takeBackState(outcome.board, outcome.receipt).ok, true)

  const back = wb.takeBackReceipt(outcome.board, outcome.receipt)

  assert.equal(back.items.some(item => item.kind === 'frame'), false)
  assert.equal(back.items.find(item => item.id === 'b').x, 600)
  assert.equal(back.items.find(item => item.id === 'b').frame, undefined)

  const edited = { ...outcome.board, items: outcome.board.items.map(item => (item.id === 'a' ? { ...item, rev: 'changed', text: 'edited' } : item)) }

  assert.equal(wb.takeBackState(edited, outcome.receipt).ok, false)
  assert.equal(wb.takeBackReceipt(edited, outcome.receipt), null)
  assert.match(wb.applyProposalItem(board, { kind: 'group', noteIds: ['a', 'gone'], title: 'X' }).error, /gone/)
})

test('actions land in their section or under the note they come out of', () => {
  const wb = load()
  const frame = { h: 300, id: 'f1', kind: 'frame', rev: 'r', title: 'Pricing', w: 2 * 196 + 66, x: 0, y: 0 }
  const note = wb.makeNote({ frame: 'f1', id: 'n1', text: 'Annual vs monthly unclear', x: 22, y: 64 })
  const loose = wb.makeNote({ id: 'n2', text: 'Charged twice', x: 900, y: 0 })
  const board = boardWith(wb, [frame, note, loose])
  const inFrame = wb.applyProposalItem(board, { kind: 'action', owner: 'Maya', section: 'pricing', text: 'Rewrite the plans page' })
  const added = inFrame.board.items.find(item => item.text === 'Rewrite the plans page')

  assert.equal(added.frame, 'f1')
  assert.equal(added.action, true)
  assert.equal(added.owner, 'Maya')
  assert.ok(wb.inside(wb.centerOf(added), wb.rectOf(inFrame.board.items.find(item => item.id === 'f1'))))

  const under = wb.applyProposalItem(board, { from: 'n2', kind: 'action', text: 'Refund the double charge' })
  const refund = under.board.items.find(item => item.text === 'Refund the double charge')

  assert.ok(refund.y > loose.y)
  assert.equal(under.board.links.at(-1).from, 'n2')
  assert.equal(under.board.links.at(-1).to, refund.id)

  const owned = wb.applyProposalItem(board, { kind: 'owner', noteId: 'n2', owner: 'Dev' })

  assert.equal(owned.board.items.find(item => item.id === 'n2').owner, 'Dev')
  assert.equal(owned.receipt.before[0].owner, undefined)
})

test('a grouping reply keeps only suggestions that point at real notes', () => {
  const wb = load()
  const ids = new Map([['n1', 'a'], ['n2', 'b'], ['n3', 'c']])
  const lookup = new Map([['c', { id: 'c', text: 'Ship the fix' }]])
  const proposal = wb.tidyProposal(
    {
      actions: [{ reason: 'Clear next step', source: 'n3', text: 'Write the fix plan' }, { text: '' }],
      groups: [{ notes: ['n1', 'n2', 'n9'], reason: 'Same topic', sticker: 'bug', title: 'Bugs' }, { notes: ['n1', 'n3'], title: 'Reuses n1' }],
      owners: [{ note: 'n3', owner: 'Rosa', reason: 'She owns releases' }, { note: 'n7', owner: 'Ghost' }],
      summary: 'Two themes'
    },
    ids,
    lookup
  )

  assert.equal(proposal.items.length, 3)
  assert.deepEqual(Array.from(proposal.items[0].noteIds), ['a', 'b'])
  assert.equal(proposal.items[1].from, 'c')
  assert.equal(proposal.items[2].owner, 'Rosa')
  assert.equal(proposal.items[2].noteText, 'Ship the fix')
  assert.equal(wb.tidyProposal({ groups: [] }, ids, lookup), null)
})

test('accepting through the panel records a receipt, and undo and redo walk the history', () => {
  const wb = load({ storage: memoryStorage() })
  const a = wb.makeNote({ id: 'a', text: 'One', x: 0, y: 0 })
  const b = wb.makeNote({ id: 'b', text: 'Two', x: 300, y: 0 })

  wb.$board.set(boardWith(wb, [a, b]))
  wb.setBoard({ ...wb.$board.get(), proposals: [{ id: 'p1', items: [{ id: 'i1', kind: 'group', noteIds: ['a', 'b'], state: 'pending', title: 'Both' }] }] })

  const receipt = wb.decideProposal('p1', 'i1', true)

  assert.ok(receipt)
  assert.equal(wb.$board.get().proposals[0].items[0].state, 'applied')
  assert.equal(wb.$board.get().items.filter(item => item.kind === 'frame').length, 1)
  assert.equal(wb.decideProposal('p1', 'i1', true), null)
  assert.equal(wb.takeBack(receipt.id), true)
  assert.equal(wb.$board.get().items.filter(item => item.kind === 'frame').length, 0)
  assert.equal(wb.$board.get().receipts[0].undone, true)
  assert.equal(wb.undo(), true)
  assert.equal(wb.$board.get().items.filter(item => item.kind === 'frame').length, 1)
  assert.equal(wb.redo(), true)
  assert.equal(wb.$board.get().items.filter(item => item.kind === 'frame').length, 0)
})

test('moving a frame carries its notes, and a note dropped in a frame joins it and grows it', () => {
  const wb = load({ storage: memoryStorage() })
  const frame = { h: 200, id: 'f', kind: 'frame', rev: 'r', title: 'Group', w: 240, x: 0, y: 0 }
  const kid = wb.makeNote({ frame: 'f', id: 'k', x: 22, y: 64 })
  const outside = wb.makeNote({ id: 'o', x: 800, y: 800 })

  wb.$board.set(boardWith(wb, [frame, kid, outside]))
  wb.moveItems(['f'], 100, 50)

  let items = new Map(wb.$board.get().items.map(item => [item.id, item]))

  assert.equal(items.get('k').x, 122)
  assert.equal(items.get('k').y, 114)
  assert.equal(items.get('o').x, 800)

  wb.moveItems(['o'], -650, -690)
  items = new Map(wb.$board.get().items.map(item => [item.id, item]))
  assert.equal(items.get('o').frame, 'f')
  assert.ok(items.get('f').h >= items.get('o').y + items.get('o').h - items.get('f').y)

  wb.removeItems(['f'])
  items = new Map(wb.$board.get().items.map(item => [item.id, item]))
  assert.equal(items.has('f'), false)
  assert.equal(items.get('k').frame, undefined)
})

test('a delivered result is read back from JSON, or kept whole when the agent forgot it', () => {
  const wb = load()
  const parsed = wb.parseRunReply('Done.\n{"headline": "Three suppliers", "result": "- A\\n- B", "sources": ["https://a.example/x", "nope"]}')

  assert.equal(parsed.headline, 'Three suppliers')
  assert.equal(parsed.text, '- A\n- B')
  assert.deepEqual(Array.from(parsed.sources), ['https://a.example/x'])

  const loose = wb.parseRunReply('## Draft email\nHello team')

  assert.equal(loose.headline, 'Draft email')
  assert.match(loose.text, /Hello team/)
  assert.equal(wb.parseRunReply('   '), null)
})

test('Markdown and the chat copy follow sections in reading order', () => {
  const wb = load()
  const { items, links } = wb.layoutSpec(wb.parseBoardSpec(SPEC), { x: 0, y: 0 })
  const action = items.find(item => item.action)
  const result = { for: action.id, h: 150, id: 'd1', kind: 'result', sources: ['https://x.example'], text: '- Alpha bakery', title: 'Three suppliers', w: 300, x: 0, y: 0 }
  const board = { ...wb.emptyBoard('Spring bake sale'), items: [...items, wb.makeNote({ id: 'loose', owner: 'Dev', text: 'Ask about permits', x: 5000, y: 0 }), result], links }
  const md = wb.boardMarkdown(board)

  assert.match(md, /^# Spring bake sale/)
  assert.ok(md.indexOf('## Day 1: Kickoff') < md.indexOf('## Stop 2: Pricing'))
  assert.match(md, /- \[ \] Compare three bakery suppliers/)
  assert.match(md, /Hermes delivered: Three suppliers/)
  assert.match(md, /Source: https:\/\/x.example/)
  assert.match(md, /## Notes\n\n- Ask about permits \(Dev\)/)

  const copy = wb.sharedBoardCopy(board)

  assert.deepEqual(Array.from(copy.sections, section => section.title), ['Kickoff', 'Pricing', 'Ship it'])
  assert.equal(copy.notes.find(note => note.id === action.id).section, 'Kickoff')
  assert.match(copy.notes.find(note => note.id === action.id).result, /Three suppliers/)
  assert.equal(copy.notes.find(note => note.id === 'loose').section, undefined)
})

test('a chat proposal becomes review items, never direct edits', () => {
  const wb = load()
  const proposal = wb.chatProposal({
    actions: [{ owner: 'Mia', reason: 'Deadline', text: 'Book the venue' }],
    groups: [{ notes: ['a', 'b'], reason: 'Same', title: 'Logistics' }, { notes: ['a'], title: 'Too small' }],
    notes: [{ reason: 'Missing', section: 'Pricing', text: 'Add a tip jar' }, { text: '' }],
    summary: 'Tidy up'
  })

  assert.equal(proposal.from, 'chat')
  assert.deepEqual(Array.from(proposal.items, item => item.kind), ['note', 'group', 'action'])
  assert.ok(proposal.items.every(item => item.state === 'pending'))
  assert.equal(wb.chatProposal({ notes: [] }), null)
})

test('export goes through the SDK save dialog and the plugin backend, never the desktop bridge', async () => {
  const calls = []
  const wb = load({
    os: { pickSavePath: async options => { calls.push(options); return '/Users/me/retro.md' } },
    rest: async (route, request) => { calls.push({ body: request.body, route }); return { ok: true, path: request.body.path } }
  })

  wb.$board.set({ ...wb.emptyBoard('Q4 retro'), items: [wb.makeNote({ text: 'Good launch', x: 0, y: 0 })] })

  assert.equal(await wb.exportBoard('md'), '/Users/me/retro.md')
  assert.equal(calls[0].defaultPath, 'q4-retro.md')
  assert.equal(calls[1].route, '/picked-file/write')
  assert.match(calls[1].body.text, /# Q4 retro\n\n## Notes\n\n- Good launch/)
  assert.equal(SOURCE.includes('hermesDesktop'), false)
  assert.equal(SOURCE.includes('readFileText'), false)
})

test('a saved board comes back, and runs that were going when Hermes closed show as stopped', () => {
  const saved = { ...{ id: 'b1', items: [{ id: 'n', kind: 'note', run: { state: 'running' }, x: 0, y: 0, w: 10, h: 10 }], links: [{ from: 'n', id: 'l', to: 'gone' }], name: 'Saved' } }
  const storage = memoryStorage({ 'board:b1': saved, 'boards-v1': { activeId: 'b1', boards: [{ id: 'b1', name: 'Saved' }] } })
  const wb = load({ storage })

  wb.hydrate(storage)
  assert.equal(wb.$board.get().name, 'Saved')
  assert.equal(wb.$board.get().items[0].run.state, 'stopped')
  assert.equal(wb.$board.get().links.length, 0)
})

test('the page and the chat tools agree on the sticker names', () => {
  const wb = load()
  const python = fs.readFileSync(new URL('../tools.py', import.meta.url), 'utf8')
  const listed = [...python.match(/STICKERS = \(([^)]+)\)/)[1].matchAll(/"([a-z]+)"/g)].map(match => match[1])

  assert.deepEqual(Array.from(wb.STICKER_NAMES), listed)
})

test('placeholder owners are dropped and frames fit their titles', () => {
  const wb = load()
  const ids = new Map([['n1', 'a'], ['n2', 'b']])
  const proposal = wb.tidyProposal({ actions: [{ owner: 'unassigned', source: 'n1', text: 'Audit checkout' }, { owner: 'Maya', text: 'Warn before trial ends' }], owners: [{ note: 'n2', owner: 'TBD' }] }, ids, new Map())

  assert.equal(proposal.items[0].owner, undefined)
  assert.equal(proposal.items[1].owner, 'Maya')
  assert.equal(proposal.items.length, 2)

  const a = wb.makeNote({ id: 'a', text: 'One', x: 0, y: 0 })
  const b = wb.makeNote({ id: 'b', text: 'Two', x: 0, y: 200 })
  const outcome = wb.applyProposalItem({ ...wb.emptyBoard(), items: [a, b] }, { kind: 'group', noteIds: ['a', 'b'], title: 'Email deliverability and spam' })
  const frame = outcome.board.items.find(item => item.kind === 'frame')

  assert.ok(frame.w >= 78 + 'Email deliverability and spam'.length * 10.5 - 1)
})

test('a step from a grouped note joins its group, and a growing group never covers another note', () => {
  const wb = load()
  const frame = { h: 300, id: 'f', kind: 'frame', rev: 'r', title: 'Billing', w: 240, x: 0, y: 0 }
  const a = wb.makeNote({ frame: 'f', id: 'a', text: 'Charged twice', x: 22, y: 64 })
  const below = wb.makeNote({ id: 'below', text: 'Loose note right under the group', x: 22, y: 320 })
  let board = { ...wb.emptyBoard(), items: [frame, a, below] }

  const step = wb.applyProposalItem(board, { from: 'a', kind: 'action', text: 'Refund the double charge' })
  const refund = step.board.items.find(item => item.text === 'Refund the double charge')

  assert.equal(refund.frame, 'f')

  board = step.board

  const grownFrame = board.items.find(item => item.id === 'f')
  const moved = board.items.find(item => item.id === 'below')

  assert.equal(wb.overlaps(wb.rectOf(grownFrame), wb.rectOf(moved)), false)

  const notes = board.items.filter(item => item.kind === 'note')

  for (const x of notes) {
    for (const y of notes) {
      if (x !== y) {
        assert.equal(wb.overlaps(wb.rectOf(x), wb.rectOf(y)), false, `${x.text} overlaps ${y.text}`)
      }
    }
  }

  const back = wb.takeBackReceipt(board, step.receipt)

  assert.equal(back.items.find(item => item.id === 'below').y, 320)
  assert.equal(back.items.some(item => item.text === 'Refund the double charge'), false)
})

test('a run visits sections in road order, open actions only, loose ones last', () => {
  const wb = load()
  const { items, links } = wb.layoutSpec(wb.parseBoardSpec({ ...SPEC, sections: [SPEC.sections[0], { notes: [{ action: true, text: 'Price the box' }], title: 'Pricing' }, SPEC.sections[2]] }), { x: 0, y: 0 })
  const done = items.find(item => item.text === 'Price the box')
  const board = { ...wb.emptyBoard(), items: [...items.map(item => (item === done ? { ...item, status: 'delivered' } : item)), wb.makeNote({ action: true, id: 'loose', text: 'Call the venue', x: 9000, y: 0 })], links }
  const stops = wb.planStops(board)

  assert.deepEqual(Array.from(stops, stop => stop.section?.title ?? null), ['Kickoff', 'Pricing', 'Ship it', null])
  assert.deepEqual(Array.from(stops, stop => stop.notes.length), [1, 0, 0, 1])
  assert.equal(stops[0].notes[0].text, 'Compare three bakery suppliers')
  assert.equal(wb.openActionCount(board), 2)
})

test('a run skips a plain group with nothing to do, but never a stop on the road', () => {
  const wb = load()
  const { items, links } = wb.layoutSpec(wb.parseBoardSpec(SPEC), { x: 0, y: 0 })
  const empty = { h: 300, id: 'empty', kind: 'frame', rev: 1, title: 'Parking lot', w: 400, x: 9000, y: 0 }
  const stops = wb.planStops({ ...wb.emptyBoard(), items: [...items, empty], links })

  assert.equal(stops.some(stop => stop.section?.id === 'empty'), false)
  assert.equal(stops.filter(stop => stop.section?.kind === 'waypoint').length, items.filter(item => item.kind === 'waypoint').length)
})

test('undo and redo end any typing, so a removed note cannot stay in edit mode', () => {
  const wb = load()

  wb.setBoard({ ...wb.emptyBoard(), items: [] })
  wb.setBoard({ ...wb.$board.get(), items: [wb.makeNote({ id: 'fresh', text: '', x: 0, y: 0 })] })
  wb.$editing.set('fresh')
  assert.equal(wb.undo(), true)
  assert.equal(wb.$editing.get(), null)
  wb.$editing.set('fresh')
  assert.equal(wb.redo(), true)
  assert.equal(wb.$editing.get(), null)
})

test('the road knows how far along each stop sits', () => {
  const wb = load()
  const fractions = wb.pathFractions([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 300 }])

  assert.deepEqual(Array.from(fractions), [0, 0.25, 1])
  assert.deepEqual(Array.from(wb.pathFractions([{ x: 5, y: 5 }])), [0])
})

test('arrows connect two different items once, and leave with either end', () => {
  const wb = load({ storage: memoryStorage() })
  const a = wb.makeNote({ id: 'a', x: 0, y: 0 })
  const b = wb.makeNote({ id: 'b', x: 400, y: 0 })

  wb.$board.set({ ...wb.emptyBoard(), items: [a, b] })
  assert.equal(wb.addArrow('a', 'b'), true)
  assert.equal(wb.addArrow('a', 'b'), false)
  assert.equal(wb.addArrow('a', 'a'), false)
  assert.equal(wb.addArrow('a', undefined), false)
  assert.equal(wb.$board.get().links.length, 1)

  const edge = wb.edgePoint(wb.rectOf(a), wb.centerOf(b))

  assert.ok(edge.x > a.x + a.w && Math.abs(edge.y - (a.y + a.h / 2)) < 1)
  wb.removeItems(['b'])
  assert.equal(wb.$board.get().links.length, 0)
  wb.undo()
  wb.removeArrows(['a'])
  assert.equal(wb.$board.get().links.length, 0)
})

test('ink keeps its points inside its own box, and a dot is not a stroke', () => {
  const wb = load()
  const ink = wb.inkFromPoints([{ x: 100, y: 50 }, { x: 160, y: 90 }, { x: 130, y: 20 }], 'gold')

  assert.deepEqual([ink.x, ink.y, ink.w, ink.h], [100, 20, 60, 70])
  assert.deepEqual(Array.from(ink.points, point => Array.from(point)), [[0, 30], [60, 70], [30, 0]])
  assert.equal(ink.tone, 'gold')
  assert.equal(wb.inkFromPoints([{ x: 1, y: 1 }, { x: 2, y: 2 }]), null)
  assert.equal(wb.inkFromPoints([{ x: 1, y: 1 }]), null)
  assert.equal(wb.inkFromPoints([{ x: 0, y: 0 }, { x: 50, y: 0 }], 'nope').tone, 'ink')
})

test('resize respects a minimum and grows a frame back over its notes', () => {
  const wb = load({ storage: memoryStorage() })
  const frame = { h: 300, id: 'f', kind: 'frame', rev: 'r', title: 'G', w: 480, x: 0, y: 0 }
  const kid = wb.makeNote({ frame: 'f', id: 'k', x: 22, y: 64 })

  wb.$board.set({ ...wb.emptyBoard(), items: [frame, kid] })
  wb.resizeItem('k', 10, 10)
  assert.deepEqual([wb.$board.get().items[1].w, wb.$board.get().items[1].h], [140, 88])
  wb.resizeItem('f', 10, 10)

  const shrunk = wb.$board.get().items[0]

  assert.ok(shrunk.w >= 22 + 140 && shrunk.h >= 64 + 88)
})

test('duplicate copies a frame with its notes and the arrows between them', () => {
  const wb = load({ storage: memoryStorage() })
  const frame = { h: 300, id: 'f', kind: 'frame', rev: 'r', title: 'G', w: 480, x: 0, y: 0 }
  const a = wb.makeNote({ frame: 'f', id: 'a', status: 'delivered', text: 'A', x: 22, y: 64 })
  const b = wb.makeNote({ frame: 'f', id: 'b', text: 'B', x: 240, y: 64 })
  const other = wb.makeNote({ id: 'o', text: 'O', x: 900, y: 0 })

  wb.$board.set({ ...wb.emptyBoard(), items: [frame, a, b, other], links: [{ from: 'a', id: 'l1', kind: 'arrow', to: 'b' }, { from: 'a', id: 'l2', kind: 'arrow', to: 'o' }] })
  wb.$selection.set(['f'])
  assert.equal(wb.duplicateSelection(), true)

  const board = wb.$board.get()
  const copyFrame = board.items.find(item => item.kind === 'frame' && item.id !== 'f')
  const copies = board.items.filter(item => item.frame === copyFrame.id)

  assert.equal(board.items.length, 7)
  assert.equal(copies.length, 2)
  assert.equal(copyFrame.x, 36)
  assert.equal(copies.find(item => item.text === 'A').status, undefined)
  assert.equal(board.links.length, 3)
  assert.deepEqual(Array.from(wb.$selection.get()), [copyFrame.id])
  assert.equal(wb.withChildren(board, ['o']).length, 1)
})

test('action toggling flips notes together', () => {
  const wb = load({ storage: memoryStorage() })

  wb.$board.set({ ...wb.emptyBoard(), items: [wb.makeNote({ id: 'a' }), wb.makeNote({ action: true, id: 'b', tone: 'peach' })] })
  wb.toggleAction(['a', 'b'])
  assert.deepEqual(Array.from(wb.$board.get().items, item => [item.action, item.tone]).map(pair => Array.from(pair)), [[true, 'peach'], [true, 'peach']])
  wb.toggleAction(['a', 'b'])
  assert.deepEqual(Array.from(wb.$board.get().items, item => item.action), [undefined, undefined])
})

test('a question covers the picked items and the notes inside a picked section', () => {
  const wb = load()
  const frame = { h: 300, id: 'f', kind: 'frame', rev: 'r', title: 'G', w: 480, x: 0, y: 0 }
  const a = wb.makeNote({ frame: 'f', id: 'a', x: 22, y: 64 })
  const b = wb.makeNote({ id: 'b', x: 900, y: 0 })
  const result = { for: 'b', h: 100, id: 'd', kind: 'result', text: 'x', w: 100, x: 0, y: 0 }
  const board = { ...wb.emptyBoard(), items: [frame, a, b, result] }

  assert.deepEqual(Array.from(wb.askScope(board, ['f']), item => item.id), ['f', 'a'])
  assert.deepEqual(Array.from(wb.askScope(board, ['b']), item => item.id), ['b', 'd'])
  assert.equal(wb.suggestedNotes({ notes: ['Plain', { action: true, text: 'Do it' }, { text: '' }] }, 'a').map(item => item.kind).join(), 'note,action')
  assert.deepEqual(Array.from(wb.bulletsOf('Intro\n- **First** point\n2. Second point\nnot a bullet\n* x')), ['First point', 'Second point'])
})

test('the board as a table follows section order and quotes CSV safely', () => {
  const wb = load()
  const { items, links } = wb.layoutSpec(wb.parseBoardSpec(SPEC), { x: 0, y: 0 })
  const action = items.find(item => item.action)
  const board = { ...wb.emptyBoard(), items: [...items, { for: action.id, h: 1, id: 'd', kind: 'result', sources: ['https://a.example', 'https://b.example'], title: 'Three, "good" ones', w: 1, x: 0, y: 0 }], links }
  const rows = wb.boardTable(board)

  assert.deepEqual(Array.from(rows[0]), ['section', 'note', 'type', 'owner', 'due', 'status', 'result', 'sources'])
  assert.deepEqual(Array.from(rows.slice(1), row => row[0]), ['Kickoff', 'Kickoff', 'Pricing'])
  assert.deepEqual(Array.from(rows.find(row => row[2] === 'action')).slice(5), ['delivered', 'Three, "good" ones', 'https://a.example https://b.example'])
  assert.match(wb.toDelimited(rows, ','), /"Three, ""good"" ones"/)
  assert.equal(wb.toDelimited([['a\tb', 'c\nd']], '\t'), 'a b\tc d')
})

test('a CSV export goes through the same picked-file route', async () => {
  const calls = []
  const wb = load({
    os: { pickSavePath: async options => { calls.push(options); return '/Users/me/board.csv' } },
    rest: async (route, request) => { calls.push({ body: request.body, route }); return { ok: true, path: request.body.path } }
  })

  wb.$board.set({ ...wb.emptyBoard('Plan'), items: [wb.makeNote({ text: 'One', x: 0, y: 0 })] })
  await wb.exportBoard('csv')
  assert.equal(calls[0].defaultPath, 'plan.csv')
  assert.equal(calls[1].route, '/picked-file/write')
  assert.match(calls[1].body.text, /^section,note,type,owner,due,status,result,sources\n,One,note/)
})

test('route results stack away from the road and never cover the title', () => {
  const wb = load()
  const { items } = wb.layoutSpec(wb.parseBoardSpec(SPEC), { x: 0, y: 0 })
  const [above, below] = items.filter(item => item.kind === 'waypoint')
  const board = { ...wb.emptyBoard(), items }
  const up = wb.routeResultSpot(board, above, 200)
  const down = wb.routeResultSpot(board, below, 200)
  const topNote = Math.min(...items.filter(item => item.frame === above.id).map(item => item.y))

  assert.equal(up.y, topNote - 18 - 200)
  assert.ok(down.y > below.y + below.h)

  const card = { h: 200, id: 'd', kind: 'result', w: 300, ...up }
  const lifted = wb.liftTitle([...items, card])
  const title = lifted.find(item => item.kind === 'text')

  assert.ok(title.y + title.h < card.y)
  assert.equal(wb.liftTitle(items), items)
})
