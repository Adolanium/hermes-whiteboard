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
        takeBackReceipt, takeBackState, tidyProposal, undo, chatProposal, suiteListen, takeSuiteNotes,
        $models, $modelOptions, cleanModelChoice, loadModelOptions, runSession, setModelChoice,
        $chatBridge, backendKey, finalAssistantText, profileRequest, recoverReply, setChatSharing, syncChats,
        boardFromKanban, kanbanCardOf, kanbanSpec, sendToKanban,
        $handoff, $runs, askLinkedChat, chatRequest, linkChat, listChats, requestHand, requestRun, seatInChat, takeChatEntry, unlinkChat,
        $asks, $kanbanLive, $kanbanReads, $panel, chatEvent, finishAsk, followAsk, kanbanDrift, refreshFromKanban, refreshKanbanStatus, syncFromKanban, watchLinkedChat
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
    host: { navigate: () => undefined, notify: () => undefined, onEvent: () => () => undefined, request: async () => ({}), ...(options.host || {}) },
    icons: {},
    jsx: () => null,
    jsxs: () => null,
    Math,
    Object,
    setTimeout: options.setTimeout || (() => 1),
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

test('notes from Data or Sheets land as one new group beside the board, and one undo removes them', () => {
  const wb = load({ storage: memoryStorage() })

  wb.hydrate(memoryStorage())
  wb.setBoard({ ...wb.$board.get(), items: [wb.makeNote({ id: 'mine', text: 'My own note', x: 0, y: 0 })] })

  const heard = {}

  wb.suiteListen((type, listener) => {
    heard[type] = listener
  })

  const hello = { detail: { peers: [] } }

  heard['hermes-suite:hello'](hello)
  assert.deepEqual(Array.from(hello.detail.peers), ['whiteboard'])

  const elsewhere = { detail: { notes: ['x'], taken: false, to: 'data' } }
  const empty = { detail: { notes: ['', '   ', null], taken: false, to: 'whiteboard' } }
  const sent = { detail: { from: 'data', notes: ['Saturday takes 35% of revenue', 'Latte alone is 48% of cups', '', 'x'.repeat(400)], taken: false, title: 'Weekends carry the cart', to: 'whiteboard' } }

  heard['hermes-suite:notes'](elsewhere)
  heard['hermes-suite:notes'](empty)
  assert.equal(elsewhere.detail.taken, false)
  assert.equal(empty.detail.taken, false)
  assert.equal(wb.$board.get().items.length, 1)

  heard['hermes-suite:notes'](sent)
  assert.equal(sent.detail.taken, true)

  const items = wb.$board.get().items
  const frame = items.find(item => item.kind === 'frame')
  const notes = items.filter(item => item.frame === frame.id)

  assert.equal(frame.title, 'Weekends carry the cart')
  assert.deepEqual(Array.from(notes, note => note.text.length), [29, 26, 280])
  assert.equal(notes.every(note => note.by === 'you' && wb.inside(wb.rectOf(note), wb.rectOf(frame))), true)
  // Beside what was there, never on top of it.
  assert.equal(wb.overlaps(wb.rectOf(frame), wb.rectOf(items[0]), 0), false)
  assert.equal(items[0].text, 'My own note')
  assert.deepEqual(Array.from(wb.$selection.get()), [frame.id])

  // The same event delivered twice is taken once.
  heard['hermes-suite:notes'](sent)
  assert.equal(wb.$board.get().items.length, 5)
  wb.undo()
  assert.equal(wb.$board.get().items.length, 1)

  assert.equal(wb.takeSuiteNotes({ from: 'sheets', notes: Array.from({ length: 40 }, (_, index) => `row ${index}`) }) !== '', true)
  assert.equal(wb.$board.get().items.filter(item => item.kind === 'note').length, 25)
})

/** A stand-in gateway: records every request, answers session calls, and lets a
 *  test finish the turn the way Hermes would. */
function gateway(options = {}) {
  const calls = []
  const listeners = {}
  let sessions = 0
  const host = {
    onEvent: (name, listener) => {
      listeners[name] = [...(listeners[name] || []), listener]

      return () => {
        listeners[name] = listeners[name].filter(entry => entry !== listener)
      }
    },
    request: async (method, params = {}) => {
      calls.push([method, JSON.parse(JSON.stringify(params))])

      if (method === 'session.create') {
        const refusal = options.refuse?.(params)

        if (refusal) {
          throw Object.assign(new Error(refusal.message), { code: refusal.code })
        }

        sessions += 1

        return { session_id: `s${sessions}`, stored_session_id: `stored${sessions}` }
      }

      if (method === 'prompt.submit') {
        for (const listener of listeners['message.complete'] || []) {
          listener({ payload: { text: options.reply ?? '{"headline": "Done", "result": "All done."}' }, session_id: params.session_id })
        }
      }

      if (method === 'model.options') {
        if (options.models instanceof Error) {
          throw options.models
        }

        return options.models ?? { providers: [] }
      }

      return {}
    }
  }

  return { calls, creates: () => calls.filter(([method]) => method === 'session.create').map(([, params]) => params), host }
}

test('with Hermes default chosen, a session is created with no model at all', async () => {
  const hermes = gateway()
  const wb = load({ host: hermes.host, storage: memoryStorage() })

  wb.hydrate(memoryStorage())
  assert.deepEqual(JSON.parse(JSON.stringify(wb.$models.get())), { agent: null, planning: null })

  const planning = await wb.runSession({ maxMs: 1000, maxSteps: 4, role: 'planning', text: 'lay it out', title: 'Whiteboard: test' })
  const agent = await wb.runSession({ maxMs: 1000, maxSteps: 4, text: 'do it', title: 'Whiteboard: test' })

  assert.deepEqual(hermes.creates(), [{ hidden: true, title: 'Whiteboard: test' }, { hidden: true, title: 'Whiteboard: test' }])
  assert.equal(planning.model, '')
  assert.equal(agent.model, '')
  assert.equal(agent.reply.includes('All done.'), true)
})

test('a chosen model reaches session.create on the hidden path and on the fallback path', async () => {
  const modern = gateway()
  const wb = load({ host: modern.host, storage: memoryStorage() })

  wb.hydrate(memoryStorage())
  wb.setModelChoice('agent', { model: 'gpt-5.5', provider: 'openai', secret: 'never stored' })
  assert.deepEqual(JSON.parse(JSON.stringify(wb.$models.get().agent)), { model: 'gpt-5.5', provider: 'openai' })

  const run = await wb.runSession({ maxMs: 1000, maxSteps: 4, role: 'agent', text: 'do it', title: 'T' })

  assert.deepEqual(modern.creates(), [{ hidden: true, model: 'gpt-5.5', provider: 'openai', title: 'T' }])
  assert.equal(run.model, 'gpt-5.5')

  // An older backend refuses `hidden`: the second create still carries the model, then hides the session.
  const older = gateway({ refuse: params => (params.hidden ? { code: 4000, message: 'unknown parameter: hidden' } : null) })
  const old = load({ host: older.host, storage: memoryStorage() })

  old.hydrate(memoryStorage())
  old.setModelChoice('agent', { model: 'hermes-4-pro', provider: '' })
  await old.runSession({ maxMs: 1000, maxSteps: 4, role: 'agent', text: 'do it', title: 'T' })
  assert.deepEqual(older.creates(), [{ hidden: true, model: 'hermes-4-pro', title: 'T' }, { model: 'hermes-4-pro', title: 'T' }])
  assert.deepEqual(older.calls.find(([method]) => method === 'session.set_hidden')[1], { hidden: true, session_id: 's1' })
})

test('planning runs and agent runs each get their own model, and the choice is stored', async () => {
  const hermes = gateway()
  const storage = memoryStorage()
  const wb = load({ host: hermes.host, storage })

  wb.hydrate(storage)
  wb.setModelChoice('planning', { model: 'hermes-4-pro', provider: 'anthropic' })
  wb.setModelChoice('agent', { model: 'gpt-5.5', provider: 'openai' })
  wb.setModelChoice('nonsense', { model: 'x' })
  await wb.runSession({ maxMs: 1000, maxSteps: 4, role: 'planning', text: 'group', title: 'P' })
  await wb.runSession({ maxMs: 1000, maxSteps: 4, role: 'agent', text: 'do', title: 'A' })
  assert.deepEqual(hermes.creates().map(params => [params.title, params.model, params.provider]), [['P', 'hermes-4-pro', 'anthropic'], ['A', 'gpt-5.5', 'openai']])
  assert.deepEqual(JSON.parse(JSON.stringify(storage.get('models'))), { agent: { model: 'gpt-5.5', provider: 'openai' }, planning: { model: 'hermes-4-pro', provider: 'anthropic' } })

  // The choice comes back after a restart, and "Hermes default" clears it.
  const again = load({ host: gateway().host, storage })

  again.hydrate(storage)
  assert.equal(again.$models.get().agent.model, 'gpt-5.5')
  again.setModelChoice('agent', null)
  assert.equal(again.$models.get().agent, null)
  assert.equal(storage.get('models').agent, null)
  assert.equal(again.cleanModelChoice({ model: '   ' }), null)
  assert.equal(again.cleanModelChoice('gpt-5.5'), null)
})

test('a model Hermes refuses fails the run with a clear message and never falls back to the default', async () => {
  const hermes = gateway({ refuse: params => (params.model ? { code: -32602, message: "Model 'gpt-5.5' is not served by provider 'anthropic'." } : null) })
  const wb = load({ host: hermes.host, storage: memoryStorage() })

  wb.hydrate(memoryStorage())
  wb.setModelChoice('agent', { model: 'gpt-5.5', provider: 'anthropic' })
  await assert.rejects(wb.runSession({ maxMs: 1000, maxSteps: 4, role: 'agent', text: 'do it', title: 'T' }), error => {
    assert.match(error.message, /^Agent model gpt-5\.5 isn't available in Hermes\./)
    assert.match(error.message, /not served by provider/)

    return true
  })
  // One attempt, with the model. No second create without it, and nothing was submitted.
  assert.deepEqual(hermes.creates(), [{ hidden: true, model: 'gpt-5.5', provider: 'anthropic', title: 'T' }])
  assert.equal(hermes.calls.some(([method]) => method === 'prompt.submit'), false)

  // A planning run names its own setting, and an unrelated failure is passed through as it is.
  wb.setModelChoice('planning', { model: 'gpt-5.5', provider: 'anthropic' })
  await assert.rejects(wb.runSession({ maxMs: 1000, maxSteps: 4, role: 'planning', text: 'x', title: 'T' }), /^Error: Planning model gpt-5\.5 isn't available/)

  const down = gateway({ refuse: () => ({ code: 5001, message: 'gateway restarting' }) })
  const other = load({ host: down.host, storage: memoryStorage() })

  other.hydrate(memoryStorage())
  await assert.rejects(other.runSession({ maxMs: 1000, maxSteps: 4, text: 'x', title: 'T' }), /^Error: gateway restarting$/)
})

test('the model pickers list only providers Hermes says are signed in', async () => {
  const hermes = gateway({
    models: {
      model: 'hermes-4-pro',
      provider: 'anthropic',
      providers: [
        { authenticated: true, models: ['hermes-4-pro', 'hermes-4-mini', '', 7], name: 'Anthropic', slug: 'anthropic' },
        { authenticated: false, models: ['gpt-5.5'], name: 'OpenAI', slug: 'openai' },
        { models: ['local-llama'], name: '', slug: 'custom:lab' },
        { authenticated: true, models: [], name: 'Empty', slug: 'empty' },
        'junk'
      ]
    }
  })
  const wb = load({ host: hermes.host, storage: memoryStorage() })

  await wb.loadModelOptions()
  assert.deepEqual(JSON.parse(JSON.stringify(wb.$modelOptions.get())), {
    error: '',
    loading: false,
    providers: [
      { models: ['hermes-4-pro', 'hermes-4-mini'], name: 'Anthropic', slug: 'anthropic' },
      { models: ['local-llama'], name: 'custom:lab', slug: 'custom:lab' }
    ]
  })
  assert.deepEqual(hermes.calls, [['model.options', {}]])

  const broken = load({ host: gateway({ models: new Error('gateway restarting') }).host, storage: memoryStorage() })

  await broken.loadModelOptions()
  assert.match(broken.$modelOptions.get().error, /could not list your models: gateway restarting/)
})

/** A stand-in for Hermes with profiles: each profile has its own plugin backend,
 *  and the page's routes go to whichever profile is selected. */
function profiles(installed) {
  let current = installed[0]
  const backends = Object.fromEntries(installed.map(name => [name, { boards: new Map(), calls: [], inbox: [], sharing: false }]))
  const rest = async (path, options = {}) => {
    const backend = backends[current]

    if (!backend) {
      throw new Error('404')
    }

    backend.calls.push(`${options.method || 'GET'} ${path}`)

    if (path === '/inbox') {
      return { entries: [...backend.inbox] }
    }

    if (path === '/sharing') {
      backend.sharing = options.body.on

      if (!options.body.on) {
        backend.boards.clear()
      }
    } else if (path.startsWith('/boards/') && options.method === 'PUT') {
      backend.boards.set(path.split('/')[2], options.body)
    } else if (path.endsWith('/ack')) {
      backend.inbox = backend.inbox.filter(entry => entry.id !== path.split('/')[2])
    }

    return {}
  }

  return { backends, host: { state: { connectionId: { get: () => 'local' }, profile: { get: () => current } } }, rest, use: name => (current = name) }
}

test('after a profile switch, the new profile gets the sharing switch and the board copies', async () => {
  const hermes = profiles(['default', 'work'])
  const storage = memoryStorage()
  const wb = load({ host: hermes.host, rest: hermes.rest, storage })

  wb.hydrate(storage)
  wb.setBoard({ ...wb.$board.get(), items: [wb.makeNote({ text: 'Book the venue', x: 0, y: 0 })] })
  wb.setChatSharing(true)

  const seen = { backend: null, shared: false }

  await wb.syncChats(seen)
  assert.equal(hermes.backends.default.sharing, true)
  assert.equal(hermes.backends.default.boards.size, 1)
  assert.equal(hermes.backends.work.sharing, false)

  // A second round on the same profile sends nothing again.
  const before = hermes.backends.default.calls.length

  await wb.syncChats(seen)
  assert.deepEqual(hermes.backends.default.calls.slice(before), ['GET /inbox'])

  hermes.use('work')
  await wb.syncChats(seen)
  assert.equal(hermes.backends.work.sharing, true)
  assert.equal(hermes.backends.work.boards.size, 1)
  assert.equal(wb.$chatBridge.get(), 'ok')
  assert.equal(wb.backendKey(), 'local|work')

  // Sharing switched off in one profile reaches the other when Hermes is back on it.
  wb.setChatSharing(false)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(hermes.backends.work.boards.size, 0)
  assert.equal(hermes.backends.default.boards.size, 1)
  hermes.use('default')
  await wb.syncChats(seen)
  assert.equal(hermes.backends.default.sharing, false)
  assert.equal(hermes.backends.default.boards.size, 0)
})

test('a profile without the plugin says so, and the sync comes back when Hermes returns', async () => {
  const hermes = profiles(['default'])
  const storage = memoryStorage()
  const wb = load({ host: hermes.host, rest: hermes.rest, storage })

  wb.hydrate(storage)
  wb.setChatSharing(true)

  const seen = { backend: null, shared: false }

  await wb.syncChats(seen)
  assert.equal(wb.$chatBridge.get(), 'ok')

  hermes.use('work')
  await wb.syncChats(seen)
  assert.equal(wb.$chatBridge.get(), 'missing')
  assert.equal(seen.shared, false)

  hermes.use('default')
  hermes.backends.default.sharing = false
  await wb.syncChats(seen)
  assert.equal(wb.$chatBridge.get(), 'ok')
  assert.equal(hermes.backends.default.sharing, true)
})

test('a reply that arrives after a profile switch is not taken as the new profile\'s', async () => {
  const hermes = profiles(['default', 'work'])
  const storage = memoryStorage()
  let switchDuringInbox = true
  const rest = async (path, options) => {
    const answer = await hermes.rest(path, options)

    if (path === '/inbox' && switchDuringInbox) {
      switchDuringInbox = false
      hermes.use('work')
    }

    return answer
  }
  const wb = load({ host: hermes.host, rest, storage })

  wb.hydrate(storage)
  hermes.backends.default.inbox.push({ id: 'w0123456789ab', kind: 'board', layout: SPEC.layout, name: SPEC.title, sections: SPEC.sections })

  const seen = { backend: null, shared: false }
  const boards = wb.$index.get().boards.length

  await wb.syncChats(seen)
  assert.equal(wb.$index.get().boards.length, boards)
  assert.equal(hermes.backends.work.calls.length, 0)
  assert.equal(hermes.backends.default.inbox.length, 1)

  // Back on the first profile, the entry is taken once and acknowledged there.
  hermes.use('default')
  await wb.syncChats(seen)
  assert.equal(wb.$index.get().boards.length, boards + 1)
  assert.equal(hermes.backends.default.inbox.length, 0)
})

/** A stand-in for Hermes Desktop serving two profiles from one gateway: a plain
 *  request lands in the gateway's own profile, a routed one in the profile named. */
function sharedGateway(options = {}) {
  const calls = []
  const host = {
    profileRoutes: async () => {
      if (options.noRoutes) {
        throw new Error('routing unavailable')
      }

      return [
        { connectionId: 'local', mode: 'local', profile: 'default', targetProfile: 'default' },
        { connectionId: 'other', mode: 'remote', profile: 'work', targetProfile: 'work' },
        { connectionId: 'local', mode: 'local', profile: 'work', targetProfile: 'work' }
      ]
    },
    request: async (method, params) => {
      calls.push({ method, params, via: 'request' })

      return { session_id: 's1' }
    },
    requestProfile: async (route, method, params, timeoutMs, extra) => {
      calls.push({ extra, method, params, route, via: 'requestProfile' })

      return { session_id: 's1' }
    },
    state: { connectionId: { get: () => 'local' }, profile: { get: () => options.profile ?? 'work' } }
  }

  if (options.old) {
    delete host.requestProfile
    delete host.profileRoutes
  }

  return { calls, host }
}

test('a new session is started in the profile selected in Hermes, not the gateway\'s own', async () => {
  const hermes = sharedGateway()
  const page = load({ host: hermes.host, storage: memoryStorage() })

  await page.profileRequest('session.create', { hidden: true, title: 'T' })
  await page.profileRequest('session.create', { title: 'T' })

  const plain = JSON.parse(JSON.stringify(hermes.calls))

  assert.equal(plain.length, 2)
  assert.deepEqual(plain[0], {
    extra: { spawnPriority: 'foreground' },
    method: 'session.create',
    params: { hidden: true, title: 'T' },
    route: { connectionId: 'local', mode: 'local', profile: 'work', targetProfile: 'work' },
    via: 'requestProfile'
  })
  assert.equal(plain[1].route.connectionId, 'local')
})

test('without a route list the profile is named, and an older Hermes keeps the plain request', async () => {
  const bare = sharedGateway({ noRoutes: true })
  const page = load({ host: bare.host, storage: memoryStorage() })

  await page.profileRequest('session.create', { title: 'T' })
  assert.equal(bare.calls[0].via, 'requestProfile')
  assert.equal(bare.calls[0].route, 'work')

  const old = sharedGateway({ old: true })
  const older = load({ host: old.host, storage: memoryStorage() })

  await older.profileRequest('session.create', { title: 'T' })
  assert.equal(old.calls[0].via, 'request')
  assert.deepEqual(JSON.parse(JSON.stringify(old.calls[0].params)), { title: 'T' })
})

test('Hand to Hermes, Ask and the model list all go to the selected profile', async () => {
  const hermes = sharedGateway()
  const listeners = {}

  hermes.host.onEvent = (name, listener) => {
    listeners[name] = listener

    return () => undefined
  }

  const routed = hermes.host.requestProfile

  hermes.host.requestProfile = async (...args) => {
    await routed(...args)

    return args[1] === 'model.options' ? { providers: [] } : { session_id: 's1', stored_session_id: 'stored1' }
  }
  hermes.host.request = async (method, params) => {
    hermes.calls.push({ method, params, via: 'request' })

    if (method === 'prompt.submit') {
      listeners['message.complete']({ payload: { text: '{"headline": "Done", "result": "All done."}' }, session_id: params.session_id })
    }

    return {}
  }

  const wb = load({ host: hermes.host, storage: memoryStorage() })

  wb.hydrate(memoryStorage())
  await wb.runSession({ maxMs: 1000, maxSteps: 4, role: 'agent', text: 'do it', title: 'T' })
  await wb.loadModelOptions()
  assert.deepEqual(hermes.calls.filter(call => call.via === 'requestProfile').map(call => `${call.method} ${call.route.profile}`), ['session.create work', 'model.options work'])
  // What follows names the session, so Hermes scopes it by the session itself.
  assert.equal(hermes.calls.some(call => call.via === 'request' && call.method === 'prompt.submit' && call.params.session_id === 's1'), true)
  assert.equal(hermes.calls.some(call => call.via === 'request' && call.method === 'session.create'), false)
})

test('an answer missing from the completion is read back from the stored transcript', async () => {
  const asked = []
  const page = (host => { const wb = load({ host, storage: memoryStorage() }); wb.hydrate(memoryStorage()); return wb })({
    request: async (method, params) => {
      asked.push([method, params.session_id])

      return {
        messages: [
          { role: 'assistant', text: 'An older answer.' },
          { role: 'user', text: 'Do it' },
          { role: 'assistant', text: 'Looking into it.' },
          { name: 'web_search', role: 'tool' },
          { role: 'assistant', text: '{"headline": "Done", "result": "Stored answer."}' }
        ]
      }
    }
  })

  assert.equal(await page.recoverReply('s1', 'streamed text'), '{"headline": "Done", "result": "Stored answer."}')
  assert.deepEqual(asked, [['session.history', 's1']])
  // Only what came after the newest user turn counts.
  assert.equal(page.finalAssistantText([{ role: 'assistant', text: 'Old.' }, { role: 'user', text: 'Again' }]), '')
})

test('when the transcript cannot be read, what was streamed is used, and nothing stays nothing', async () => {
  let tries = 0
  const down = (host => { const wb = load({ host, storage: memoryStorage() }); wb.hydrate(memoryStorage()); return wb })({
    request: async () => {
      tries += 1
      throw new Error('gateway restarting')
    }
  })

  assert.equal(await down.recoverReply('s1', 'Streamed answer.'), 'Streamed answer.')
  assert.equal(tries, 2)

  const empty = (host => { const wb = load({ host, storage: memoryStorage() }); wb.hydrate(memoryStorage()); return wb })({ request: async () => ({ messages: [{ role: 'user', text: 'Do it' }] }) })

  assert.equal(await empty.recoverReply('s1', ''), '')
})

/** A stand-in gateway whose turn ends the way a test says: any events, then a completion. */
function turnGateway({ complete, events = [], history }) {
  const calls = []
  const listeners = {}
  const fire = (name, payload) => (listeners[name] || []).forEach(listener => listener({ payload, session_id: 's1' }))
  const host = {
    onEvent: (name, listener) => {
      listeners[name] = [...(listeners[name] || []), listener]

      return () => {
        listeners[name] = listeners[name].filter(entry => entry !== listener)
      }
    },
    request: async (method, params = {}) => {
      calls.push(method)

      if (method === 'session.create') {
        return { session_id: 's1', stored_session_id: 'stored1' }
      }

      if (method === 'session.history') {
        if (history instanceof Error) {
          throw history
        }

        return { messages: history }
      }

      if (method === 'prompt.submit') {
        events.forEach(([name, payload]) => fire(name, payload))
        fire('message.complete', complete)
      }

      return {}
    }
  }

  return { calls, host }
}

test('a run whose completion carries no text still returns the stored answer', async () => {
  const hermes = turnGateway({
    complete: { status: 'complete', text: '' },
    events: [['message.delta', { text: '{"headline": "Done", ' }], ['message.delta', { text: '"result": "Streamed."}' }]],
    history: [{ role: 'user', text: 'do it' }, { role: 'assistant', text: '{"headline": "Done", "result": "Stored."}' }]
  })
  const page = (host => { const wb = load({ host, storage: memoryStorage() }); wb.hydrate(memoryStorage()); return wb })(hermes.host)
  const run = await page.runSession({ maxMs: 1000, maxSteps: 4, text: 'do it', title: 'T' })

  assert.equal(run.reply, '{"headline": "Done", "result": "Stored."}')
  assert.equal(hermes.calls.filter(method => method === 'session.history').length, 1)
})

test('with no transcript to read, the text streamed after the last tool call is the answer', async () => {
  const hermes = turnGateway({
    complete: { status: 'complete', text: null },
    events: [
      ['message.delta', { text: 'Let me look that up.' }],
      ['tool.start', { name: 'web_search' }],
      ['message.delta', { text: '{"headline": "Done", ' }],
      ['message.delta', { text: '"result": "Streamed."}' }]
    ],
    history: new Error('unknown method')
  })
  const page = (host => { const wb = load({ host, storage: memoryStorage() }); wb.hydrate(memoryStorage()); return wb })(hermes.host)
  const run = await page.runSession({ maxMs: 1000, maxSteps: 4, text: 'do it', title: 'T' })

  assert.equal(run.reply, '{"headline": "Done", "result": "Streamed."}')
  assert.equal(run.steps, 1)
})

test('a completion that carries its text is used as it is, with no transcript read', async () => {
  const hermes = turnGateway({ complete: { status: 'complete', text: '{"headline": "Done", "result": "Direct."}' }, events: [['message.delta', { text: 'partial' }]], history: [] })
  const page = (host => { const wb = load({ host, storage: memoryStorage() }); wb.hydrate(memoryStorage()); return wb })(hermes.host)
  const run = await page.runSession({ maxMs: 1000, maxSteps: 4, text: 'do it', title: 'T' })

  assert.equal(run.reply, '{"headline": "Done", "result": "Direct."}')
  assert.equal(hermes.calls.includes('session.history'), false)

  // A failed turn with no text is still a failure, not an empty answer.
  const failed = turnGateway({ complete: { status: 'error', text: '' }, history: [] })

  await assert.rejects((host => { const wb = load({ host, storage: memoryStorage() }); wb.hydrate(memoryStorage()); return wb })(failed.host).runSession({ maxMs: 1000, maxSteps: 4, text: 'do it', title: 'T' }), /ended as error/)
})

// ---------------------------------------------------------------- Hermes Kanban
/** A stand-in for the plugin's backend routes that reach Kanban. */
function kanbanBackend(options = {}) {
  const calls = []
  const rest = async (path, request = {}) => {
    calls.push([path, request.method || 'GET', request.body ? JSON.parse(JSON.stringify(request.body)) : null])

    if (options.down) {
      throw new Error('404')
    }

    if (path === '/kanban/cards') {
      return options.refuse ? { error: options.refuse, ok: false } : { board: request.body.board, cards: request.body.cards.map((card, index) => ({ id: `t_${index + 1}`, key: card.key, title: card.title })), ok: true }
    }

    if (path.startsWith('/kanban/board/')) {
      return options.read ?? { board: 'launch', columns: [{ cards: [{ id: 't_1', title: 'Book the venue' }, { id: 't_2', title: 'Order flyers' }], status: 'todo' }, { cards: [{ id: 't_3', title: 'Pick a date' }], status: 'done' }], name: 'Launch plan', ok: true }
    }

    return {}
  }

  return { calls, rest }
}

test('a note becomes a Kanban card with its first line as the title and what the board knows below', () => {
  const wb = load({ storage: memoryStorage() })

  wb.hydrate(memoryStorage())

  const note = wb.makeNote({ due: 'Friday', owner: 'Sam', text: 'Call the venue\nAsk about the Saturday rate and parking' })
  const board = { ...wb.$board.get(), items: [note, { for: note.id, headline: 'Venue is free on the 14th', id: 'r1', kind: 'result', x: 0, y: 0 }], name: 'Launch' }
  const card = wb.kanbanCardOf(board, note)

  assert.equal(card.title, 'Call the venue')
  assert.equal(card.key, `${board.id}:${note.id}`)
  assert.equal(card.body, 'Call the venue\nAsk about the Saturday rate and parking\n\nOwner: Sam\nDue: Friday\nResult on the board: Venue is free on the 14th\n\nFrom the Whiteboard board "Launch".')
})

test('Send to Kanban makes one card per picked note, marks the notes, and one undo takes the marks off', async () => {
  const backend = kanbanBackend()
  const storage = memoryStorage()
  const wb = load({ rest: backend.rest, storage })

  wb.hydrate(storage)

  const first = wb.makeNote({ text: 'Book the venue', x: 0, y: 0 })
  const second = wb.makeNote({ text: 'Order flyers', x: 300, y: 0 })
  const blank = wb.makeNote({ text: '   ', x: 600, y: 0 })

  wb.setBoard({ ...wb.$board.get(), items: [first, second, blank] })
  assert.equal(await wb.sendToKanban([first.id, second.id, blank.id, 'missing'], 'launch'), 2)

  const sent = backend.calls.find(([path]) => path === '/kanban/cards')

  assert.equal(sent[1], 'POST')
  assert.equal(sent[2].board, 'launch')
  // Parked unless asked: the page only asks Hermes to start on a real true.
  assert.equal(sent[2].start, false)
  assert.deepEqual(sent[2].cards.map(card => card.title), ['Book the venue', 'Order flyers'])

  const items = wb.$board.get().items

  assert.deepEqual(JSON.parse(JSON.stringify(items.find(item => item.id === first.id).kanban)), { board: 'launch', id: 't_1' })
  assert.deepEqual(JSON.parse(JSON.stringify(items.find(item => item.id === second.id).kanban)), { board: 'launch', id: 't_2' })
  assert.equal(items.find(item => item.id === blank.id).kanban, undefined)
  wb.undo()
  assert.equal(wb.$board.get().items.some(item => item.kanban), false)
})

test('Send to Kanban says why when it cannot, and marks nothing', async () => {
  const storage = memoryStorage()
  const refused = load({ rest: kanbanBackend({ refuse: 'That Kanban board does not exist any more.' }).rest, storage })

  refused.hydrate(storage)

  const note = refused.makeNote({ text: 'Book the venue', x: 0, y: 0 })

  refused.setBoard({ ...refused.$board.get(), items: [note] })
  await assert.rejects(refused.sendToKanban([note.id], 'gone'), /does not exist any more/)
  await assert.rejects(refused.sendToKanban([], 'launch'), /Pick a note with some text/)
  assert.equal(refused.$board.get().items[0].kanban, undefined)

  const down = load({ rest: kanbanBackend({ down: true }).rest, storage: memoryStorage() })

  down.hydrate(memoryStorage())
  down.setBoard({ ...down.$board.get(), items: [note] })
  await assert.rejects(down.sendToKanban([note.id], 'launch'), /backend isn't running in this Hermes profile/)

  // The backend runs but does not know the Kanban routes yet: it is the version from before an update.
  const older = load({ rest: async path => (path === '/inbox' ? { entries: [] } : Promise.reject(new Error('404'))), storage: memoryStorage() })

  older.hydrate(memoryStorage())
  older.setBoard({ ...older.$board.get(), items: [note] })
  await assert.rejects(older.sendToKanban([note.id], 'launch'), /still the older version.*Restart the Hermes gateway/)

  const many = Array.from({ length: 25 }, (_, index) => refused.makeNote({ text: `Note ${index}`, x: index, y: 0 }))

  refused.setBoard({ ...refused.$board.get(), items: many })
  await assert.rejects(refused.sendToKanban(many.map(item => item.id), 'launch'), /at most 24 notes/)
})

test('a Kanban board lays out as a new whiteboard with one column per status', async () => {
  const backend = kanbanBackend()
  const storage = memoryStorage()
  const wb = load({ rest: backend.rest, storage })

  wb.hydrate(storage)

  const before = wb.$index.get().boards.length
  const spec = wb.kanbanSpec({ columns: [{ cards: [{ title: 'Book the venue' }, { title: '' }], status: 'todo' }, { cards: [], status: 'done' }, { cards: [{ title: 'Ship it' }], status: 'review' }], name: 'Launch plan' })

  assert.equal(spec.layout, 'columns')
  assert.equal(spec.title, 'Launch plan, from Kanban')
  assert.deepEqual(Array.from(spec.sections, section => section.title), ['To do', 'Review'])
  assert.equal(wb.kanbanSpec({ columns: [], name: 'Empty' }), null)
  // One status only still makes a board: the next status stands beside it, empty.
  assert.deepEqual(Array.from(wb.kanbanSpec({ columns: [{ cards: [{ title: 'Book the venue' }], status: 'triage' }], name: 'Launch plan' }).sections, section => [section.title, section.notes.length]), [['Triage', 1], ['To do', 0]])
  assert.deepEqual(Array.from(wb.kanbanSpec({ columns: [{ cards: [{ title: 'Shipped' }], status: 'done' }], name: 'Launch plan' }).sections, section => section.title), ['Review', 'Done'])

  assert.equal(await wb.boardFromKanban('launch'), 3)
  assert.equal(wb.$index.get().boards.length, before + 1)
  assert.equal(wb.$board.get().name, 'Launch plan, from Kanban')
  assert.equal(wb.$board.get().items.filter(item => item.kind === 'note').length, 3)
  // Reading is all it does: nothing is sent back to Kanban.
  assert.deepEqual(backend.calls.map(([path, method]) => `${method} ${path}`), ['GET /kanban/board/launch'])

  const empty = load({ rest: kanbanBackend({ read: { board: 'launch', columns: [], name: 'Launch plan', ok: true } }).rest, storage: memoryStorage() })

  empty.hydrate(memoryStorage())
  await assert.rejects(empty.boardFromKanban('launch'), /no cards to lay out/)
})

// ---------------------------------------------------------------- a board linked to a chat
test('a board a chat made is linked to that chat, and linking is one undo', () => {
  const storage = memoryStorage()
  const wb = load({ storage })

  wb.hydrate(storage)

  const sections = [{ notes: [{ action: true, text: 'Book the venue' }], title: 'Plan' }, { notes: [{ text: 'Tell people' }], title: 'Ship' }]

  assert.equal(wb.takeChatEntry({ chat: '20261113_101500_ab12cd', kind: 'board', layout: 'route', name: 'Launch', sections }), 'taken')
  assert.equal(wb.takeChatEntry({ kind: 'board', layout: 'route', name: 'Loose', sections }), 'taken')
  assert.equal(wb.takeChatEntry({ chat: { id: 'x' }, kind: 'board', layout: 'route', name: 'Odd', sections }), 'taken')

  const stored = name => [...storage.values.values()].find(value => value?.name === name && Array.isArray(value.items))

  assert.deepEqual(JSON.parse(JSON.stringify(stored('Launch').chat)), { id: '20261113_101500_ab12cd' })
  assert.equal(stored('Loose').chat, undefined)
  assert.equal(stored('Odd').chat, undefined)

  assert.equal(wb.linkChat({ id: '', title: 'Nothing' }), false)
  assert.equal(wb.linkChat({ id: 's_77', title: '  Venue   planning ' }), true)
  assert.deepEqual(JSON.parse(JSON.stringify(wb.$board.get().chat)), { id: 's_77', title: 'Venue planning' })
  wb.unlinkChat()
  assert.equal('chat' in wb.$board.get(), false)
  wb.undo()
  assert.equal(wb.$board.get().chat.id, 's_77')
})

test('the request for the linked chat names the board and the items, and asks for no repeat work', () => {
  const wb = load({ storage: memoryStorage() })

  wb.hydrate(memoryStorage())

  const board = { ...wb.$board.get(), name: 'Launch' }
  const one = wb.chatRequest(board, [wb.makeNote({ due: 'Friday', owner: 'Sam', text: 'Book the\nvenue' })], false)

  assert.match(one, /^From the Whiteboard board "Launch", which is linked to this chat\./)
  assert.match(one, /Please do this item from the board:\n\n- Book the venue \(owner: Sam\) \(due: Friday\)/)
  assert.match(one, /already done or under way, say so instead of doing it again/)
  // With chat access off the chat cannot write to the board, so it is not asked to.
  assert.doesNotMatch(one, /whiteboard_propose/)

  const two = wb.chatRequest(board, [wb.makeNote({ text: 'A' }), wb.makeNote({ text: 'B' })], true)

  assert.match(two, /Please do these 2 items from the board, in this order:\n\n- A\n- B/)
  assert.match(two, /whiteboard_propose \(board "Launch", "results"/)
})

test('on a linked board Hand to Hermes and Run ask first and start nothing', async () => {
  const requests = []
  const storage = memoryStorage()
  const wb = load({ host: { request: async (method, params) => (requests.push([method, params]), {}) }, storage })

  wb.hydrate(storage)

  const note = wb.makeNote({ action: true, text: 'Book the venue', x: 0, y: 0 })

  wb.setBoard({ ...wb.$board.get(), chat: { id: 's_77', title: 'Venue planning' }, items: [note] })
  wb.requestHand([note.id])
  assert.deepEqual(JSON.parse(JSON.stringify(wb.$handoff.get())), { noteIds: [note.id] })
  wb.$handoff.set(null)
  wb.requestRun()
  assert.deepEqual(JSON.parse(JSON.stringify(wb.$handoff.get())), { noteIds: [note.id], plan: true })
  await new Promise(resolve => setTimeout(resolve, 20))
  // No session was created and nothing was submitted anywhere.
  assert.deepEqual(requests.filter(([method]) => method === 'session.create' || method === 'prompt.submit'), [])
  assert.equal(wb.$runs.get()[note.id], undefined)
})

test('asking the linked chat opens it, seats the request in its message box and marks the notes', async () => {
  const seen = []
  const storage = memoryStorage()
  const wb = load({
    host: {
      composer: { focus: id => seen.push(['focus', id]), insertText: async (id, text, options) => (seen.push(['insert', id, text, options]), seen.filter(([what]) => what === 'insert').length >= 2), submit: () => seen.push(['submit']) },
      openSession: async id => seen.push(['open', id]),
      request: async (method, params) => (seen.push(['request', method, params]), {})
    },
    setTimeout: run => (run(), 1),
    storage
  })

  wb.hydrate(storage)

  const note = wb.makeNote({ action: true, text: 'Book the venue', x: 0, y: 0 })
  const blank = wb.makeNote({ text: ' ', x: 300, y: 0 })

  wb.setBoard({ ...wb.$board.get(), items: [note, blank], name: 'Launch' })
  await assert.rejects(wb.askLinkedChat([note.id]), /not linked to a chat/)
  wb.setBoard({ ...wb.$board.get(), chat: { id: 's_77' } })
  await assert.rejects(wb.askLinkedChat([blank.id]), /Pick a note with some text/)
  assert.equal(await wb.askLinkedChat([note.id, blank.id]), 'seated')

  assert.deepEqual(seen[0], ['open', 's_77'])

  const inserts = seen.filter(([what]) => what === 'insert')

  // The message box was not there on the first try, so it was tried again.
  assert.equal(inserts.length, 2)
  assert.equal(inserts[1][1], 's_77')
  assert.match(inserts[1][2], /- Book the venue/)
  assert.deepEqual(JSON.parse(JSON.stringify(inserts[1][3])), { mode: 'block' })
  // The page never sends for the person, and never talks to the session itself.
  assert.equal(seen.some(([what]) => what === 'submit'), false)
  assert.equal(seen.some(([what, method]) => what === 'request' && /prompt|session\.create/.test(method)), false)

  const items = wb.$board.get().items

  assert.equal(typeof items.find(item => item.id === note.id).asked, 'number')
  assert.equal(items.find(item => item.id === blank.id).asked, undefined)
})

test('when the message box never takes the request it is copied instead, or the failure is said', async () => {
  const copied = []
  const host = { composer: { insertText: async () => false }, openSession: async () => undefined }
  const quick = run => (run(), 1)
  const withClipboard = load({ host, os: { writeClipboard: async text => (copied.push(text), true) }, setTimeout: quick, storage: memoryStorage() })

  assert.equal(await withClipboard.seatInChat('s_77', 'Do the thing', 2), 'copied')
  assert.deepEqual(copied, ['Do the thing'])

  const without = load({ host, setTimeout: quick, storage: memoryStorage() })

  await assert.rejects(without.seatInChat('s_77', 'Do the thing', 2), /did not take the request/)

  const old = load({ host: { composer: host.composer }, setTimeout: quick, storage: memoryStorage() })

  await assert.rejects(old.seatInChat('s_77', 'Do the thing', 2), /Update Hermes Desktop/)
})

test('a result the chat reports becomes a card beside its note, and can be taken back', () => {
  const storage = memoryStorage()
  const wb = load({ storage })

  wb.hydrate(storage)

  const note = wb.makeNote({ action: true, text: 'Book the venue', x: 0, y: 0 })

  wb.setBoard({ ...wb.$board.get(), items: [note] })

  const proposal = wb.chatProposal({ results: [{ headline: 'Venue booked', note: note.id, noteText: 'Book the venue', reason: 'Asked from the board', text: 'The Old Mill is held for the 14th.' }, { note: 'gone', text: 'Lost' }, { note: note.id, text: '  ' }], summary: 'Done in chat' })

  assert.equal(proposal.items.length, 2)
  assert.equal(proposal.items[0].kind, 'result')
  wb.setBoard({ ...wb.$board.get(), proposals: [proposal] })

  const receipt = wb.decideProposal(proposal.id, proposal.items[0].id, true)
  const board = wb.$board.get()
  const card = board.items.find(item => item.kind === 'result')

  assert.equal(card.for, note.id)
  assert.equal(card.title, 'Venue booked')
  assert.equal(card.text, 'The Old Mill is held for the 14th.')
  assert.equal(card.stamp, 'From chat')
  assert.equal(board.items.find(item => item.id === note.id).status, 'delivered')
  assert.equal(board.links.some(link => link.kind === 'result' && link.from === note.id && link.to === card.id), true)
  assert.equal(wb.overlaps(wb.rectOf(card), wb.rectOf(board.items.find(item => item.id === note.id))), false)

  // A result for a note that is gone is refused, not dropped on the board.
  assert.equal(wb.decideProposal(proposal.id, proposal.items[1].id, true), null)
  assert.equal(wb.$board.get().proposals[0].items[1].state, 'stale')

  assert.equal(wb.takeBack(receipt.id), true)
  assert.equal(wb.$board.get().items.some(item => item.kind === 'result'), false)
  assert.notEqual(wb.$board.get().items.find(item => item.id === note.id).status, 'delivered')
})

test('the chats to link to come from Hermes, open and stored, newest first, each once', async () => {
  const asked = []
  const wb = load({
    host: {
      request: async (method, params) => {
        asked.push([method, JSON.parse(JSON.stringify(params))])

        if (method !== 'session.list') {
          return {}
        }

        return params.scope === 'stored'
          ? { scope: 'stored', sessions: [{ id: 's_1', started_at: 30, title: 'Venue planning' }, { id: 's_2', preview: 'what about parking', started_at: 10, title: '' }, { id: '', title: 'broken' }, null, { id: 's_3', started_at: 20 }] }
          : { scope: 'live', sessions: [{ id: 's_1', session_id: 'live_1', started_at: 30, title: 'Venue planning' }] }
      }
    },
    storage: memoryStorage()
  })

  assert.deepEqual(JSON.parse(JSON.stringify(await wb.listChats())), [{ id: 's_1', sid: 'live_1', title: 'Venue planning' }, { id: 's_3', title: 'Untitled chat' }, { id: 's_2', title: 'what about parking' }])
  assert.deepEqual(asked, [['session.list', { limit: 40 }], ['session.list', { limit: 40, scope: 'stored' }]])

  // A Hermes that refuses the stored list still gives the chats it has.
  const old = load({ host: { request: async (method, params) => (params?.scope ? Promise.reject(new Error('invalid_params')) : { sessions: [{ id: 's_9', title: 'Only one' }] }) }, storage: memoryStorage() })

  assert.deepEqual(JSON.parse(JSON.stringify(await old.listChats())), [{ id: 's_9', title: 'Only one' }])
})

// ---------------------------------------------------------------- Kanban, kept in step
const plain = value => JSON.parse(JSON.stringify(value))

test('a board from Kanban holds every card, each note remembering its card', async () => {
  const cards = Array.from({ length: 7 }, (_, index) => ({ id: `t_${index + 1}`, title: `Task ${index + 1}` }))
  const backend = kanbanBackend({ read: { board: 'launch', columns: [{ cards, status: 'todo' }, { cards: [{ id: 't_9', title: 'Shipped' }], status: 'done' }], name: 'Launch plan', ok: true } })
  const storage = memoryStorage()
  const wb = load({ rest: backend.rest, storage })

  wb.hydrate(storage)
  // Seven in one column: more than a laid-out section holds, and none is dropped.
  assert.equal(await wb.boardFromKanban('launch'), 8)

  const board = wb.$board.get()
  const notes = board.items.filter(item => item.kind === 'note')

  assert.deepEqual(plain(board.fromKanban), { name: 'Launch plan', slug: 'launch' })
  assert.deepEqual(plain(notes.map(note => note.kanban.id)).sort(), ['t_1', 't_2', 't_3', 't_4', 't_5', 't_6', 't_7', 't_9'])
  assert.equal(notes.every(note => note.kanban.board === 'launch'), true)

  const todo = board.items.find(item => item.kind === 'frame' && item.title === 'To do')

  assert.equal(notes.filter(note => note.frame === todo.id).length, 7)

  for (const a of notes) {
    assert.equal(wb.inside(wb.rectOf(a), wb.rectOf(board.items.find(item => item.id === a.frame))), true, `${a.text} sits in its column`)

    for (const b of notes) {
      if (a !== b) {
        assert.equal(wb.overlaps(wb.rectOf(a), wb.rectOf(b)), false, `${a.text} overlaps ${b.text}`)
      }
    }
  }

  assert.equal(wb.kanbanDrift(board, backend.calls.length ? wb.$kanbanReads.get().launch : null), 0)
})

test('Refresh from Kanban moves notes to their card\'s new status and adds new cards, in one undo', async () => {
  const state = { read: { board: 'launch', columns: [{ cards: [{ id: 't_1', title: 'Book the venue' }, { id: 't_2', title: 'Order flyers' }], status: 'todo' }, { cards: [{ id: 't_3', title: 'Pick a date' }], status: 'done' }], name: 'Launch plan', ok: true } }
  const calls = []
  const storage = memoryStorage()
  const wb = load({ rest: async (path, request = {}) => (calls.push(`${request.method || 'GET'} ${path}`), state.read), storage })

  wb.hydrate(storage)
  await wb.boardFromKanban('launch')

  // In Kanban: one card starts running, one is archived, a new one appears.
  state.read = { board: 'launch', columns: [{ cards: [{ id: 't_2', title: 'Order flyers' }, { id: 't_4', title: 'Rent a van' }], status: 'todo' }, { cards: [{ id: 't_1', title: 'Book the venue' }], status: 'running' }], name: 'Launch plan', ok: true }
  assert.equal(wb.kanbanDrift(wb.$board.get(), state.read), 2)

  const before = wb.$board.get()

  assert.deepEqual(plain(await wb.refreshFromKanban()), { added: 1, moved: 1 })

  const board = wb.$board.get()
  const frameOf = text => board.items.find(item => item.id === board.items.find(note => note.text === text).frame).title

  assert.equal(frameOf('Book the venue'), 'Running')
  assert.equal(frameOf('Rent a van'), 'To do')
  assert.equal(frameOf('Order flyers'), 'To do')
  // The archived card's note stays where it was: the person decides what to do with it.
  assert.equal(frameOf('Pick a date'), 'Done')
  assert.equal(wb.kanbanDrift(board, state.read), 0)

  const notes = board.items.filter(item => item.kind === 'note')

  for (const a of notes) {
    for (const b of notes) {
      if (a !== b) {
        assert.equal(wb.overlaps(wb.rectOf(a), wb.rectOf(b)), false, `${a.text} overlaps ${b.text}`)
      }
    }
  }

  // Reading is all any of it did.
  assert.equal(calls.every(call => call.startsWith('GET /kanban/board/')), true)
  assert.deepEqual(plain(await wb.refreshFromKanban()), { added: 0, moved: 0 })
  wb.undo()
  assert.equal(wb.$board.get().items.length, before.items.length)

  wb.setBoard({ ...wb.$board.get(), fromKanban: undefined })
  await assert.rejects(wb.refreshFromKanban(), /not made from Kanban/)
})

test('a note shows where its Kanban card is now, and a card that is gone reads as archived', async () => {
  const backend = kanbanBackend({ read: { board: 'launch', columns: [{ cards: [{ id: 't_1', title: 'Book the venue' }], status: 'running' }], name: 'Launch plan', ok: true } })
  const storage = memoryStorage()
  const wb = load({ rest: backend.rest, storage })

  wb.hydrate(storage)
  assert.equal(await wb.refreshKanbanStatus(), null)

  const first = wb.makeNote({ text: 'Book the venue', x: 0, y: 0 })
  const second = wb.makeNote({ text: 'Order flyers', x: 300, y: 0 })

  wb.setBoard({ ...wb.$board.get(), items: [first, second] })
  await wb.sendToKanban([first.id, second.id], 'launch')
  // Straight after sending they are where they were put.
  assert.deepEqual(plain(wb.$kanbanLive.get()), { t_1: 'blocked', t_2: 'blocked' })

  const marks = plain(wb.$board.get().items.map(item => item.kanban))

  await wb.refreshKanbanStatus()
  assert.deepEqual(plain(wb.$kanbanLive.get()), { t_1: 'running', t_2: 'archived' })
  // The status is not written into the board: no undo step, nothing to save or share.
  assert.deepEqual(plain(wb.$board.get().items.map(item => item.kanban)), marks)

  const down = load({ rest: kanbanBackend({ down: true }).rest, storage: memoryStorage() })

  down.hydrate(memoryStorage())
  down.setBoard({ ...down.$board.get(), items: [{ ...first, kanban: { board: 'launch', id: 't_1' } }] })
  assert.deepEqual(plain(await down.refreshKanbanStatus()), {})
})

// ---------------------------------------------------------------- following the linked chat
function chatHost(options = {}) {
  const listeners = new Map()
  const requests = []
  const notices = []

  return {
    emit: (type, event) => (listeners.get(type) || []).forEach(listener => listener(event)),
    host: {
      composer: { insertText: async () => true },
      notify: notice => notices.push(notice),
      onEvent: (type, listener) => {
        listeners.set(type, [...(listeners.get(type) || []), listener])

        return () => listeners.set(type, (listeners.get(type) || []).filter(entry => entry !== listener))
      },
      openSession: async () => undefined,
      request: async (method, params) => {
        requests.push([method, plain(params ?? null)])

        if (method === 'session.list') {
          return { sessions: [{ id: 's_77', session_id: 'live_77', title: 'Venue planning' }, { id: 's_other', session_id: 'live_other', title: 'Something else' }] }
        }

        if (method === 'session.history') {
          return { messages: options.history ? options.history() : [] }
        }

        return {}
      }
    },
    listeners,
    notices,
    requests
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 15))

async function linkedBoard(chat, extra = {}) {
  const storage = memoryStorage()
  const wb = load({ host: chat.host, storage, ...extra })

  wb.hydrate(storage)

  const note = wb.makeNote({ action: true, text: 'Book the venue', x: 0, y: 0 })
  const other = wb.makeNote({ action: true, text: 'Order flyers', x: 300, y: 0 })

  wb.setBoard({ ...wb.$board.get(), chat: { id: 's_77' }, items: [note, other], name: 'Launch' })

  const stop = wb.watchLinkedChat()

  return { note, other, stop, wb }
}

const MARKER = 'From the Whiteboard board "Launch", which is linked to this chat.'

test('the linked chat\'s answer comes back as a result waiting under Suggestions', async () => {
  let history = [{ role: 'user', text: `${MARKER}\n\nPlease do this item from the board:\n\n- Book the venue` }, { role: 'assistant', text: '**The Old Mill is held for the 14th.**\n\nDeposit due Friday.' }]
  const chat = chatHost({ history: () => history })
  const { note, wb } = await linkedBoard(chat)

  await wb.askLinkedChat([note.id])
  assert.equal(wb.$asks.get().length, 1)
  assert.equal(wb.$asks.get()[0].state, 'waiting')

  // Another chat is busy: nothing of it is taken.
  chat.emit('message.delta', { payload: { text: 'unrelated' }, session_id: 'live_other' })
  await settle()
  chat.emit('message.complete', { payload: { text: 'unrelated answer' }, session_id: 'live_other' })
  await settle()
  assert.equal(wb.$board.get().proposals.length, 0)
  assert.equal(wb.$asks.get().length, 1)

  // The linked chat starts: the first event ties its live session to the request.
  chat.emit('message.start', { payload: {}, session_id: 'live_77' })
  await settle()
  assert.equal(wb.$asks.get()[0].sid, 'live_77')
  chat.emit('tool.start', { payload: { name: 'web_search' }, session_id: 'live_77' })
  assert.equal(wb.$asks.get()[0].state, 'working')
  chat.emit('message.delta', { payload: { text: 'The Old Mill ' }, session_id: 'live_77' })
  chat.emit('message.complete', { payload: { text: '' }, session_id: 'live_77' })
  await settle()

  assert.equal(wb.$asks.get().length, 0)

  const [proposal] = wb.$board.get().proposals
  const [item] = proposal.items

  assert.equal(proposal.summary, 'The linked chat answered')
  assert.equal(item.kind, 'result')
  assert.equal(item.noteId, note.id)
  assert.equal(item.state, 'pending')
  assert.equal(item.title, 'The Old Mill is held for the 14th.')
  assert.match(item.text, /Deposit due Friday/)
  assert.equal(wb.$panel.get(), true)
  assert.equal(chat.notices.at(-1).title, 'The linked chat answered')
  // Nothing is on the board until the person accepts it.
  assert.equal(wb.$board.get().items.some(entry => entry.kind === 'result'), false)
  // The page only read the chat.
  assert.deepEqual([...new Set(chat.requests.map(([method]) => method))].sort(), ['session.history', 'session.list'])

  history = []
})

test('an answer to something else is left alone, and the request is still waited for', async () => {
  let history = [{ role: 'user', text: 'what time is it?' }, { role: 'assistant', text: 'Half past nine.' }]
  const chat = chatHost({ history: () => history })
  const { note, wb } = await linkedBoard(chat)

  await wb.askLinkedChat([note.id])
  chat.emit('message.start', { payload: {}, session_id: 'live_77' })
  await settle()
  chat.emit('message.complete', { payload: { text: 'Half past nine.' }, session_id: 'live_77' })
  await settle()
  assert.equal(wb.$board.get().proposals.length, 0)
  assert.equal(wb.$asks.get().length, 1)
  assert.equal(wb.$asks.get()[0].state, 'waiting')

  history = [...history, { role: 'user', text: `${MARKER}\n\n- Book the venue` }, { role: 'assistant', text: 'Booked.' }]
  chat.emit('message.delta', { payload: { text: 'Booked.' }, session_id: 'live_77' })
  chat.emit('message.complete', { payload: { text: 'Booked.' }, session_id: 'live_77' })
  await settle()
  assert.equal(wb.$board.get().proposals.length, 1)
  assert.equal(wb.$board.get().proposals[0].items[0].text, 'Booked.')
})

test('when the chat reports through its own tool its answer is not taken twice, but a refused tool call does not lose it', async () => {
  const history = () => [{ role: 'user', text: `${MARKER}\n\n- Book the venue` }, { role: 'assistant', text: 'Done: the Old Mill is booked.' }]
  const run = async (wb, chat, note) => {
    await wb.askLinkedChat([note.id])
    chat.emit('message.start', { payload: {}, session_id: 'live_77' })
    await settle()
    chat.emit('tool.start', { payload: { name: 'whiteboard_propose' }, session_id: 'live_77' })
  }

  // The tool worked: its result is on the board before the turn ends.
  const first = chatHost({ history })
  const one = await linkedBoard(first, { setTimeout: go => (go(), 1) })

  await run(one.wb, first, one.note)
  one.wb.setBoard({ ...one.wb.$board.get(), proposals: [one.wb.chatProposal({ results: [{ note: one.note.id, reason: 'r', text: 'Booked, from the tool.' }], summary: 'Done' })] })
  first.emit('message.complete', { payload: { text: 'Done: the Old Mill is booked.' }, session_id: 'live_77' })
  await settle()
  assert.equal(one.wb.$board.get().proposals.length, 1)
  assert.equal(one.wb.$asks.get().length, 0)

  // The tool was refused (chat access is off): nothing arrived, so the answer itself is taken.
  const second = chatHost({ history })
  const two = await linkedBoard(second, { setTimeout: go => (go(), 1) })

  await run(two.wb, second, two.note)
  second.emit('message.complete', { payload: { text: 'Done: the Old Mill is booked.' }, session_id: 'live_77' })
  await settle()
  assert.equal(two.wb.$board.get().proposals.length, 1)
  assert.equal(two.wb.$board.get().proposals[0].summary, 'The linked chat answered')
  assert.equal(two.wb.$board.get().proposals[0].items[0].text, 'Done: the Old Mill is booked.')
})

test('one answer for several notes goes to the first, and says so; a stopped listener hears nothing', async () => {
  const chat = chatHost({ history: () => [{ role: 'user', text: `${MARKER}\n\n- Book the venue\n- Order flyers` }, { role: 'assistant', text: 'Both are done.' }] })
  const { note, other, stop, wb } = await linkedBoard(chat)

  await wb.askLinkedChat([note.id, other.id])
  chat.emit('message.start', { payload: {}, session_id: 'live_77' })
  await settle()
  chat.emit('message.complete', { payload: { text: 'Both are done.' }, session_id: 'live_77' })
  await settle()

  const [item] = wb.$board.get().proposals[0].items

  assert.equal(item.noteId, note.id)
  assert.match(item.reason, /for the 2 items you sent/)

  await wb.askLinkedChat([note.id])
  stop()
  chat.emit('message.start', { payload: {}, session_id: 'live_77' })
  await settle()
  assert.equal(wb.$asks.get()[0].sid, '')
})
