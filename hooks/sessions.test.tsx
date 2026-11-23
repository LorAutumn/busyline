import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'busyline',
  component: 'AbovePrompt',
  surface: 'desktop',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false, // the main turn has ended
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const text = (t: string) => ({ value: { content: [{ type: 'text', text: t }], isError: false } })

// The desktop app's id for the main session: `get_session("self")` answers it.
const SELF = 'local_main-0001'

// A row as list_sessions and get_session answer it (fields the mod reads).
type Row = {
  sessionId: string
  isRunning: boolean
  isArchived?: boolean
  startedBy?: string
  title?: string
}

// How start_session answers a direct start (seen in the desktop app).
const startedText = (id: string) =>
  `Started session "busyline-Test" (session_id: ${id}, name: test). It runs on its own; ` +
  'you get a note here when its turn ends.'

// Stands for the desktop app's session tools as the app answers a mod:
// `list_sessions` names every session of the person, this one included;
// with `linked: true` only this one's family (whoever started it, what it
// started, their siblings), each child naming its starter in `startedBy`.
function app(
  on: On,
  world: { rows: Row[]; isDown?: boolean; statuses?: Record<string, string> },
  calls: string[] = [],
  asked: unknown[] = [],
) {
  on('session.id', () => ({ value: 'b6f1c0de-engine-id' }))
  on('mcp.call', (_, e) => {
    calls.push(e.tool)
    if (e.server !== 'ccd_session_mgmt' || world.isDown) {
      return { value: { content: [], isError: true } }
    }
    const row = (id: string): Row | undefined =>
      id === SELF ? { sessionId: SELF, isRunning: true } : world.rows.find(r => r.sessionId === id)
    if (e.tool === 'list_sessions') {
      const rows =
        e.args.linked === true
          ? world.rows.filter(r => r.startedBy !== undefined)
          : [{ sessionId: SELF, isRunning: true }, ...world.rows]
      return text(rows.length === 0 ? 'No other sessions found.' : JSON.stringify(rows, null, 2))
    }
    if (e.tool === 'get_session') {
      asked.push(e.args.session_id)
      const id = String(e.args.session_id)
      const found = row(id === 'self' ? SELF : id)
      if (found === undefined) return { value: { content: [{ type: 'text', text: 'not found' }], isError: true } }
      return text(JSON.stringify({ isArchived: false, ...found }, null, 2))
    }
    return { value: { content: [], isError: true } }
  })
}

// ListAgents as the engine answers it: one row per peer session, named by
// its title, with `busy`, `waiting` (for the person) or `idle`.
function agents(on: On, world: { statuses?: Record<string, string> }) {
  on('tool.call', { tool: 'ListAgents' }, () => ({
    result: {
      listing: '',
      sections: [
        {
          kind: 'sessions',
          total: Object.keys(world.statuses ?? {}).length,
          rows: Object.entries(world.statuses ?? {}).map(([name, status], i) => ({
            name,
            ref: `ab${i}`,
            type: 'interactive',
            status,
          })),
        },
      ],
    },
  }))
}

// start_session answers a direct start with the new session's id in its text.
function starts(on: On, id: string | undefined) {
  on('tool.call', { tool: 'mcp__ccd_session__start_session' }, () => ({
    result: id === undefined ? 'Proposed as a card (task_id: task_ab12).' : startedText(id),
  }))
}

async function start($: Engine, on: On) {
  mock.store(on)
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'busyline' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  return clock
}

async function moving($: Engine): Promise<boolean> {
  const ui = await $.ui.mount(BAND)
  const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  await ui.unmount()
  return svg.includes('<animate')
}

test('the train rolls while a started session runs and stops when it is done', async ($, on) => {
  const world = { rows: [] as Row[] }
  app(on, world)
  starts(on, 'local_child-0001')
  const clock = await start($, on)
  expect(await moving($)).toBe(false)

  await $.tool.call({ tool: 'mcp__ccd_session__start_session', title: 't', prompt: 'p' })
  // The list may not name it yet: the id from the answer is asked about.
  world.rows.push({ sessionId: 'local_child-0001', isRunning: true, startedBy: SELF })
  await clock.advance(10_000)
  expect(await moving($)).toBe(true)

  world.rows[0] = { ...world.rows[0]!, isRunning: false }
  await clock.advance(10_000)
  expect(await moving($)).toBe(false)
})

test('a started session counts from the answer even before the list names it', async ($, on) => {
  // Not linked yet, so the family list leaves it out; get_session knows it.
  app(on, { rows: [{ sessionId: 'local_child-0002', isRunning: true }] })
  starts(on, 'local_child-0002')
  await start($, on)

  await $.tool.call({ tool: 'mcp__ccd_session__start_session', title: 't', prompt: 'p' })
  expect(await moving($)).toBe(true)
})

test('other sessions of the person do not move the train', async ($, on) => {
  app(on, {
    rows: [
      // Not linked: the person's work in another project.
      { sessionId: 'local_other-0001', isRunning: true },
      // The session that started this one, and a sibling it started.
      { sessionId: 'local_parent-0001', isRunning: true, startedBy: 'local_grand-0001' },
      { sessionId: 'local_sibling-0001', isRunning: true, startedBy: 'local_parent-0001' },
      // Finished or archived children of this one.
      { sessionId: 'local_done-0001', isRunning: false, startedBy: SELF },
      { sessionId: 'local_shelved-0001', isRunning: true, isArchived: true, startedBy: SELF },
    ],
  })
  const clock = await start($, on)
  await clock.advance(30_000)
  expect(await moving($)).toBe(false)
})

test('the main session never counts as its own child', async ($, on) => {
  // The mod's own list names the main session, running while its turn does.
  app(on, { rows: [{ sessionId: 'local_child-0003', isRunning: false, startedBy: SELF }] })
  starts(on, 'local_child-0003')
  const clock = await start($, on)
  await $.tool.call({ tool: 'mcp__ccd_session__start_session', title: 't', prompt: 'p' })
  await clock.advance(10_000)
  expect(await moving($)).toBe(false)
})

test('the word session_id in the answer is no session', async ($, on) => {
  const asked: unknown[] = []
  app(on, { rows: [] }, [], asked)
  starts(on, 'local_child-0004')
  await start($, on)
  await $.tool.call({ tool: 'mcp__ccd_session__start_session', title: 't', prompt: 'p' })
  expect(asked).toContain('local_child-0004')
  expect(asked).not.toContain('session_id')
})

test('a started session is asked about however many sessions the person has', async ($, on) => {
  const rows: Row[] = Array.from({ length: 40 }, (_, i) => ({
    sessionId: `local_other-${String(i).padStart(4, '0')}`,
    isRunning: false,
  }))
  const world = { rows }
  app(on, world)
  starts(on, 'local_child-0005')
  const clock = await start($, on)
  await $.tool.call({ tool: 'mcp__ccd_session__start_session', title: 't', prompt: 'p' })
  world.rows.push({ sessionId: 'local_child-0005', isRunning: true, startedBy: SELF })
  await clock.advance(10_000)
  expect(await moving($)).toBe(true)
})

test('a resumed conversation picks up sessions it started before', async ($, on) => {
  app(on, { rows: [{ sessionId: 'local_old-0001', isRunning: true, startedBy: SELF }] })
  await start($, on)
  expect(await moving($)).toBe(true)
})

test('without the desktop app it stops asking', async ($, on) => {
  const calls: string[] = []
  on('mcp.call', (_, e) => {
    calls.push(e.tool)
    return { value: { content: [{ type: 'text', text: 'no such server' }], isError: true } }
  })
  const clock = await start($, on)
  await clock.advance(60_000)
  expect(calls).toEqual(['list_sessions'])
  expect(await moving($)).toBe(false)
})

test('a conversation that started nothing looks once', async ($, on) => {
  const calls: string[] = []
  // Busy sessions elsewhere do not keep the watch on.
  app(on, { rows: [{ sessionId: 'local_other-0001', isRunning: true }] }, calls)
  const clock = await start($, on)
  await clock.advance(60_000)
  expect(calls).toEqual(['list_sessions'])
  expect(await moving($)).toBe(false)
})

test('a suggestion card started later is picked up', async ($, on) => {
  const world = { rows: [] as Row[] }
  app(on, world)
  starts(on, undefined)
  const clock = await start($, on)

  // The card: nothing runs yet, but the watch stays on.
  await $.tool.call({ tool: 'mcp__ccd_session__start_session', title: 't', prompt: 'p' })
  expect(await moving($)).toBe(false)

  world.rows.push({ sessionId: 'local_card-0001', isRunning: true, startedBy: SELF })
  await clock.advance(10_000)
  expect(await moving($)).toBe(true)
})

test('the train rolls from the main turn\'s start even while the prop still reads idle', async ($, on) => {
  app(on, { rows: [] })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await start($, on)
  expect(await moving($)).toBe(false)

  // BAND's `isWorking` stays false: the prop as the turn's start reads it.
  await $.turn.start({ text: 'hi', turnId: 't1' })
  expect(await moving($)).toBe(true)

  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await moving($)).toBe(false)
})

test('a moment without the app does not end the watch', async ($, on) => {
  const world = {
    rows: [{ sessionId: 'local_child-0006', isRunning: true, startedBy: SELF }] as Row[],
    isDown: false,
  }
  app(on, world)
  const clock = await start($, on)
  expect(await moving($)).toBe(true)

  world.isDown = true
  await clock.advance(30_000)
  expect(await moving($)).toBe(true)

  world.isDown = false
  world.rows[0] = { ...world.rows[0]!, isRunning: false }
  await clock.advance(10_000)
  expect(await moving($)).toBe(false)
})

test('a follow-up message sets a started session to work again', async ($, on) => {
  const world = { rows: [{ sessionId: 'local_child-0007', isRunning: false, startedBy: SELF }] as Row[] }
  app(on, world)
  on('tool.call', { tool: 'mcp__ccd_session_mgmt__send_message' }, () => {
    world.rows[0] = { ...world.rows[0]!, isRunning: true }
    return { result: 'sent' }
  })
  await start($, on)
  expect(await moving($)).toBe(false)

  await $.tool.call({
    tool: 'mcp__ccd_session_mgmt__send_message',
    session_id: 'local_child-0007',
    message: 'weiter',
  })
  expect(await moving($)).toBe(true)
})

test('a started session waiting for the person does not move the train', async ($, on) => {
  const world = {
    rows: [
      { sessionId: 'local_child-0008', title: 'Run the tests', isRunning: true, startedBy: SELF },
    ] as Row[],
    // The app still reads it running: only ListAgents says it waits.
    statuses: { 'Run the tests': 'waiting', 'Other work': 'busy' } as Record<string, string>,
  }
  app(on, world)
  agents(on, world)
  const clock = await start($, on)
  expect(await moving($)).toBe(false)

  // The person allowed it: it works again.
  world.statuses['Run the tests'] = 'busy'
  await clock.advance(10_000)
  expect(await moving($)).toBe(true)
})

test('without ListAgents a running started session moves the train', async ($, on) => {
  app(on, { rows: [{ sessionId: 'local_child-0009', title: 'T', isRunning: true, startedBy: SELF }] })
  on('tool.call', { tool: 'ListAgents' }, () => ({ deny: 'not here' }))
  await start($, on)
  expect(await moving($)).toBe(true)
})
