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

const CHILD = 'session_01ExampleChild0000000000'
// This session, as its children name it in `parent_session_id`.
const SELF = 'session_01ExampleParent000000000'

// A session as create_session and get_session answer it (seen in a cloud
// session; the fields the mod does not read are left out).
const ccr = (id: string, bucket: string, parent: string | undefined = SELF) =>
  JSON.stringify({
    ccr: {
      id,
      title: 'busyline test: wait 30 s',
      session_status: 'SESSION_STATUS_RUNNING',
      origin: 'claude_code_mcp_seed',
      ...(parent === undefined ? {} : { parent_session_id: parent }),
      status_bucket: `SESSION_STATUS_BUCKET_${bucket.toUpperCase()}`,
    },
  })
const CREATE = 'mcp__claude-code-remote__create_session'
const SEND = 'mcp__claude-code-remote__send_message'

// Stands for Claude Code Remote as a cloud session reaches it: get_session
// answers a session's `status_bucket`, this session's own too. The desktop app's own session tools
// are not there. `calls` are the sessions asked about.
function remote(
  on: On,
  world: { buckets: Record<string, string>; isDown?: boolean },
  calls: string[] = [],
) {
  on('session.id', () => ({ value: 'b6f1c0de-engine-id' }))
  on('mcp.call', (_, e) => {
    if (e.server !== 'claude-code-remote' || world.isDown) return { value: { content: [], isError: true } }
    const id = String(e.args.session_id)
    calls.push(id)
    const bucket = world.buckets[id]
    if (e.tool !== 'get_session' || bucket === undefined) {
      return { value: { content: [{ type: 'text', text: 'not found' }], isError: true } }
    }
    const text = ccr(id, bucket, id === SELF ? undefined : SELF)
    return { value: { content: [{ type: 'text', text }], isError: false } }
  })
}

function creates(on: On, answer: unknown) {
  on('tool.call', { tool: CREATE }, () => ({ result: answer }))
  on('tool.call', { tool: SEND }, () => ({ result: 'sent' }))
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

test('the train rolls while a cloud session it started works and stops when it completes', async ($, on) => {
  const world = { buckets: { [CHILD]: 'working' } as Record<string, string> }
  remote(on, world)
  creates(on, ccr(CHILD, 'working'))
  const clock = await start($, on)
  expect(await moving($)).toBe(false)

  await $.tool.call({ tool: CREATE, prompt: 'p' })
  expect(await moving($)).toBe(true)

  world.buckets[CHILD] = 'completed'
  await clock.advance(10_000)
  expect(await moving($)).toBe(false)
})

test('a blocked cloud session stands, and rolls again once it works', async ($, on) => {
  const world = { buckets: { [CHILD]: 'blocked' } as Record<string, string> }
  remote(on, world)
  creates(on, { content: [{ type: 'text', text: ccr(CHILD, 'working') }] })
  const clock = await start($, on)

  await $.tool.call({ tool: CREATE, prompt: 'p' })
  expect(await moving($)).toBe(false)

  world.buckets[CHILD] = 'working'
  await clock.advance(10_000)
  expect(await moving($)).toBe(true)
})

test('a finished cloud session is no longer asked about', async ($, on) => {
  const world = { buckets: { [CHILD]: 'failed' } as Record<string, string> }
  const calls: string[] = []
  remote(on, world, calls)
  creates(on, `Created session ${CHILD}. Its status_bucket is working.`)
  const clock = await start($, on)

  await $.tool.call({ tool: CREATE, prompt: 'p' })
  expect(await moving($)).toBe(false)
  expect(calls).toEqual([CHILD])
  await clock.advance(60_000)
  expect(calls).toEqual([CHILD])
})

test('a message sets a finished cloud session to work again', async ($, on) => {
  const world = { buckets: { [CHILD]: 'completed' } as Record<string, string> }
  remote(on, world)
  creates(on, ccr(CHILD, 'working'))
  const clock = await start($, on)
  await $.tool.call({ tool: CREATE, prompt: 'p' })
  await clock.advance(10_000)
  expect(await moving($)).toBe(false)

  world.buckets[CHILD] = 'working'
  await $.tool.call({ tool: SEND, session_id: CHILD, message: 'go on' })
  expect(await moving($)).toBe(true)
})

test('a short outage keeps the train rolling, a long one ends the asking', async ($, on) => {
  const world = { buckets: { [CHILD]: 'working' } as Record<string, string>, isDown: false }
  const calls: string[] = []
  remote(on, world, calls)
  creates(on, ccr(CHILD, 'working'))
  const clock = await start($, on)
  await $.tool.call({ tool: CREATE, prompt: 'p' })

  world.isDown = true
  await clock.advance(30_000)
  expect(await moving($)).toBe(true)

  await clock.advance(60_000)
  expect(await moving($)).toBe(false)
  world.isDown = false
  calls.length = 0
  await clock.advance(60_000)
  expect(calls).toEqual([])
})

test('without a cloud session started, Claude Code Remote is never asked', async ($, on) => {
  const calls: string[] = []
  remote(on, { buckets: {} }, calls)
  const clock = await start($, on)
  await clock.advance(120_000)
  expect(calls).toEqual([])
  expect(await moving($)).toBe(false)
})

test('an answer that names no session starts no asking', async ($, on) => {
  const calls: string[] = []
  remote(on, { buckets: {} }, calls)
  creates(on, 'The session_id is not known yet.')
  const clock = await start($, on)
  await $.tool.call({ tool: CREATE, prompt: 'p' })
  await clock.advance(30_000)
  expect(calls).toEqual([])
})

test('the session that started the child is not taken for a child', async ($, on) => {
  // The answer names this session as the child's parent.
  const world = { buckets: { [CHILD]: 'working', [SELF]: 'working' } as Record<string, string> }
  const calls: string[] = []
  remote(on, world, calls)
  creates(on, ccr(CHILD, 'working'))
  const clock = await start($, on)
  await $.tool.call({ tool: CREATE, prompt: 'p' })
  expect(calls).toEqual([CHILD])

  world.buckets[CHILD] = 'completed'
  await clock.advance(10_000)
  expect(await moving($)).toBe(false)
})

test('a watched session that turns out to be the parent is dropped', async ($, on) => {
  const world = { buckets: { [CHILD]: 'completed', [SELF]: 'working' } as Record<string, string> }
  const calls: string[] = []
  remote(on, world, calls)
  creates(on, ccr(CHILD, 'working'))
  const clock = await start($, on)
  await $.tool.call({ tool: CREATE, prompt: 'p' })
  // A message to this session itself puts it on the list.
  await $.tool.call({ tool: SEND, session_id: SELF, message: 'm' })
  world.buckets[CHILD] = 'working'
  await $.tool.call({ tool: SEND, session_id: CHILD, message: 'm' })
  world.buckets[CHILD] = 'completed'
  await clock.advance(10_000)
  expect(await moving($)).toBe(false)
})

test('an object that names no session of its own starts no asking', async ($, on) => {
  const calls: string[] = []
  remote(on, { buckets: { [SELF]: 'working' } }, calls)
  creates(on, JSON.stringify({ ccr: { parent_session_id: SELF, status_bucket: 'SESSION_STATUS_BUCKET_WORKING' } }))
  const clock = await start($, on)
  await $.tool.call({ tool: CREATE, prompt: 'p' })
  await clock.advance(30_000)
  expect(calls).toEqual([])
  expect(await moving($)).toBe(false)
})

// The test clock resolves a limited number of waits in one advance: long
// stretches pass in steps.
async function pass(clock: { advance(ms: number): Promise<unknown> }, ms: number) {
  const step = 10 * 60 * 1000
  for (let left = ms; left > 0; left -= step) await clock.advance(Math.min(step, left))
}

test('a cloud session that waits six hours is no longer asked about, until a message', async ($, on) => {
  const world = { buckets: { [CHILD]: 'blocked' } as Record<string, string> }
  const calls: string[] = []
  remote(on, world, calls)
  creates(on, ccr(CHILD, 'working'))
  const clock = await start($, on)
  await $.tool.call({ tool: CREATE, prompt: 'p' })

  await pass(clock, 6 * 60 * 60 * 1000 - 60_000)
  const before = calls.length
  await clock.advance(30_000)
  expect(calls.length).toBeGreaterThan(before)

  await clock.advance(60_000)
  const after = calls.length
  await clock.advance(120_000)
  expect(calls.length).toBe(after)

  world.buckets[CHILD] = 'working'
  await $.tool.call({ tool: SEND, session_id: CHILD, message: 'go on' })
  expect(await moving($)).toBe(true)
})

test('a cloud session that works for more than six hours is still followed', async ($, on) => {
  const world = { buckets: { [CHILD]: 'working' } as Record<string, string> }
  remote(on, world)
  creates(on, ccr(CHILD, 'working'))
  const clock = await start($, on)
  await $.tool.call({ tool: CREATE, prompt: 'p' })

  await pass(clock, 7 * 60 * 60 * 1000)
  expect(await moving($)).toBe(true)
})
