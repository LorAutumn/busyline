import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { CommandRunResult, On } from 'claude-code'

import { THEMES } from './themes'

const BAND = {
  plugin: 'busyline',
  component: 'AbovePrompt',
  surface: 'desktop',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

function busyline($: Engine, args: string): Promise<CommandRunResult> {
  return $.command.run({
    command: 'busyline',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
}

async function start($: Engine, on: On) {
  mock.store(on)
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'busyline' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
}

test('every theme fills the band at any width', async () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    for (const width of [24, 80, 200]) {
      for (const moving of [true, false]) {
        const rows = theme.terminal(width, 7, moving)
        expect(rows.length, `${name} ${width}`).toBe(3)
        for (const row of rows) expect(row.length, `${name} ${width}`).toBe(width)
      }
    }
  }
})

test('the band draws the railcar until another theme is picked', async ($, on) => {
  await start($, on)

  let ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe(THEMES.railcar?.alt)
  await ui.unmount()

  const picked = await busyline($, 'theme custom')
  expect(picked.text).toBe('Theme: custom.')

  ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe(THEMES.custom?.alt)
  await ui.unmount()

  const shown = await busyline($, 'theme')
  expect(shown.text).toBe('Theme: custom. Available: railcar, custom.')
})

test('an unknown theme changes nothing', async ($, on) => {
  await start($, on)

  const refused = await busyline($, 'theme nope')
  expect(refused.text).toBe('Unknown theme "nope". Available: railcar, custom.')

  const shown = await busyline($, 'theme')
  expect(shown.text).toBe('Theme: railcar. Available: railcar, custom.')
})

test('off leaves the band to the engine', async ($, on) => {
  // Nothing draws beneath the plugin: this hook stands for the engine.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  await start($, on)

  await busyline($, 'off')
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})
