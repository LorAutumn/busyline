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
    isWorking: true, // the main turn runs: the dialog is part of it
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

// What the classifier answers in the next test (`ask`: it gave no verdict).
let judged: 'allow' | 'ask' = 'allow'

async function start($: Engine, on: On, verdict: 'allow' | 'ask' | 'deny' = 'ask') {
  judged = 'allow'
  mock.store(on)
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'busyline' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // No desktop app: the sub-session watch stays out of the way.
  on('mcp.call', () => ({ value: { content: [], isError: true } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.check', () => ({ decision: verdict, reason: 'a rule', rule: 'Bash(rm:*)' }))
  on('tool.judge', () => ({ decision: judged }))
  on('session.append', { door: 'tool-result' }, (_, e, next) => next(e))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })
}

async function moving($: Engine): Promise<boolean> {
  const ui = await $.ui.mount(BAND)
  const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  await ui.unmount()
  return svg.includes('<animate')
}

// The question the engine raises for the model's call that a person answers.
const ASK = { tool: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 'tu1', approver: 'person' } as const

// The call's result row, as the engine keeps it once the call ran or was refused.
const RESULT = {
  message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] },
  door: 'tool-result',
  origin: { kind: 'tool', tool: 'Bash' },
  uuid: 'row-1',
} as const

test('the train stands while a permission dialog waits for the person', async ($, on) => {
  await start($, on)
  expect(await moving($)).toBe(true)

  await $.tool.check(ASK)
  expect(await moving($)).toBe(false)

  // Allowed (or refused): the call's result row arrives.
  await $.session.append(RESULT)
  expect(await moving($)).toBe(true)
})

test('auto mode\'s classifier answers: no dialog', async ($, on) => {
  await start($, on)
  await $.tool.check(ASK)
  await $.tool.judge(ASK)
  expect(await moving($)).toBe(true)
})

test('nobody to ask: no dialog', async ($, on) => {
  await start($, on)
  await $.tool.check({ ...ASK, approver: undefined })
  expect(await moving($)).toBe(true)
})

test('an interrupted dialog does not keep the next turn standing', async ($, on) => {
  await start($, on)
  await $.tool.check(ASK)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
  await $.turn.start({ text: 'again', turnId: 't2' })
  expect(await moving($)).toBe(true)
})

test('a subagent\'s dialog leaves the main train alone', async ($, on) => {
  await start($, on)
  await $.tool.check({ ...ASK, agentId: 'a1' })
  expect(await moving($)).toBe(true)
})

test('the next dialog stays open when the previous call\'s result arrives', async ($, on) => {
  await start($, on)
  await $.tool.check(ASK)
  // Allowed, and the model's next call asks again before the row lands.
  await $.tool.check({ ...ASK, tool_use_id: 'tu2' })
  await $.session.append(RESULT)
  expect(await moving($)).toBe(false)

  await $.session.append({
    ...RESULT,
    uuid: 'row-2',
    message: { ...RESULT.message, content: [{ type: 'tool_result', tool_use_id: 'tu2', content: 'ok' }] },
  })
  expect(await moving($)).toBe(true)
})

test('a classifier without a verdict leaves the dialog to the person', async ($, on) => {
  await start($, on)
  judged = 'ask'
  await $.tool.check(ASK)
  await $.tool.judge(ASK)
  expect(await moving($)).toBe(false)
})

test('a call that is allowed or refused outright opens no dialog', async ($, on) => {
  await start($, on, 'allow')
  await $.tool.check(ASK)
  expect(await moving($)).toBe(true)
})

test('the verdict is handed up as heard', async ($, on) => {
  await start($, on)
  expect(await $.tool.check(ASK)).toMatchObject({ decision: 'ask', reason: 'a rule', rule: 'Bash(rm:*)' })
})

test('a host that answers asks is no dialog of the person', async ($, on) => {
  await start($, on)
  await $.tool.check({ ...ASK, approver: 'host' })
  expect(await moving($)).toBe(true)
})

test('a question or a plan put to the person is left to its own stop', async ($, on) => {
  await start($, on)
  await $.tool.check({ ...ASK, tool: 'ExitPlanMode', input: {} })
  // No result row in this conversation: the turn goes on working.
  expect(await moving($)).toBe(true)
})

test('one row answering two calls ends both dialogs', async ($, on) => {
  await start($, on)
  await $.tool.check(ASK)
  await $.tool.check({ ...ASK, tool_use_id: 'tu2' })
  await $.session.append({
    ...RESULT,
    message: {
      ...RESULT.message,
      content: [
        { type: 'tool_result', tool_use_id: 'tu1', content: 'ok' },
        { type: 'tool_result', tool_use_id: 'tu2', content: 'refused', is_error: true },
      ],
    },
  })
  expect(await moving($)).toBe(true)
})
