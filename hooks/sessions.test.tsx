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

// Stands for the desktop app's session tools: `running` says which of the
// started sessions run now; `started` which ones list_sessions names.
function app(
  on: On,
  sessions: { started: string[]; running: Set<string>; isDown?: boolean },
  calls: string[] = [],
) {
  on('session.id', () => ({ value: 'session_main' }))
  on('mcp.call', (_, e) => {
    calls.push(e.tool)
    if (e.server !== 'ccd_session_mgmt' || sessions.isDown) {
      return { value: { content: [], isError: true } }
    }
    if (e.tool === 'list_sessions') {
      return text(
        sessions.started.length === 0
          ? 'No other sessions found.'
          : sessions.started.map(id => `- ${id}: Some title`).join('\n'),
      )
    }
    const id = String(e.args.session_id)
    return text(JSON.stringify({ sessionId: id, isArchived: false, isRunning: sessions.running.has(id) }))
  })
  on('tool.call', { tool: 'mcp__ccd_session__start_session' }, () => ({
    result: 'Started session_child1',
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
  const sessions = { started: [] as string[], running: new Set<string>() }
  app(on, sessions)
  const clock = await start($, on)
  expect(await moving($)).toBe(false)

  sessions.started.push('session_child1')
  sessions.running.add('session_child1')
  await $.tool.call({ tool: 'mcp__ccd_session__start_session', title: 't', prompt: 'p' })
  expect(await moving($)).toBe(true)

  sessions.running.delete('session_child1')
  await clock.advance(10_000)
  expect(await moving($)).toBe(false)
})

test('a resumed conversation picks up sessions it started before', async ($, on) => {
  app(on, { started: ['session_old'], running: new Set(['session_old']) })
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
  app(on, { started: [], running: new Set() }, calls)
  const clock = await start($, on)
  await clock.advance(60_000)
  expect(calls).toEqual(['list_sessions'])
  expect(await moving($)).toBe(false)
})

test('a suggestion card started later is picked up', async ($, on) => {
  const sessions = { started: [] as string[], running: new Set<string>() }
  app(on, sessions)
  const clock = await start($, on)

  // The card: nothing runs yet, but the watch stays on.
  await $.tool.call({ tool: 'mcp__ccd_session__start_session', title: 't', prompt: 'p' })
  expect(await moving($)).toBe(false)

  sessions.started.push('session_card')
  sessions.running.add('session_card')
  await clock.advance(10_000)
  expect(await moving($)).toBe(true)
})

test('the train rolls from the main turn\'s start even while the prop still reads idle', async ($, on) => {
  app(on, { started: [], running: new Set() })
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
  const sessions = {
    started: ['session_child1'],
    running: new Set(['session_child1']),
    isDown: false,
  }
  app(on, sessions)
  const clock = await start($, on)
  expect(await moving($)).toBe(true)

  sessions.isDown = true
  await clock.advance(30_000)
  expect(await moving($)).toBe(true)

  sessions.isDown = false
  sessions.running.clear()
  await clock.advance(10_000)
  expect(await moving($)).toBe(false)
})

test('a local session is known by the id start_session answers with', async ($, on) => {
  // The list never names it: the id from the start is asked about anyway.
  const sessions = { started: [] as string[], running: new Set(['local_ab12-cd34']) }
  on('session.id', () => ({ value: 'session_main' }))
  on('mcp.call', (_, e) => {
    if (e.tool === 'list_sessions') return text('No other sessions found.')
    const id = String(e.args.session_id)
    return text(JSON.stringify({ sessionId: id, isRunning: sessions.running.has(id) }))
  })
  on('tool.call', { tool: 'mcp__ccd_session__start_session' }, () => ({
    result: 'Started. session_id: local_ab12-cd34',
  }))
  on('tool.call', { tool: 'mcp__ccd_session_mgmt__send_message' }, () => ({ result: 'sent' }))
  const clock = await start($, on)

  await $.tool.call({ tool: 'mcp__ccd_session__start_session', title: 't', prompt: 'p' })
  expect(await moving($)).toBe(true)

  sessions.running.clear()
  await clock.advance(10_000)
  expect(await moving($)).toBe(false)

  // A follow-up message sets it to work again.
  sessions.running.add('local_ab12-cd34')
  await $.tool.call({
    tool: 'mcp__ccd_session_mgmt__send_message',
    session_id: 'local_ab12-cd34',
    message: 'weiter',
  })
  expect(await moving($)).toBe(true)
})
