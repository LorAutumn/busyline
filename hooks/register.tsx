import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { DEFAULT_THEME, THEMES, themeOf } from './themes'
import type { Background, Shell } from '../types'

const ENABLED = 'enabled' // store key; absent means on
const THEME = 'theme' // store key; absent means DEFAULT_THEME

const IDLE: Background = { agents: [], shells: [] }
const background = atom({ plugin: 'busyline', key: 'busy' } as const, IDLE)

async function currentTheme($: EngineInterface): Promise<string> {
  const stored = await $.store.get(THEME)
  return typeof stored === 'string' ? stored : DEFAULT_THEME
}

const RECONCILE_MS = 3000
// A shell whose output has not grown for this long is asked whether it is
// still alive; one that cannot be asked is given up after the hard limit.
const SHELL_SILENCE_MS = 2 * 60 * 1000
const SHELL_UNKNOWN_LIMIT_MS = 60 * 60 * 1000

type Liveness = 'alive' | 'gone' | 'unknown'

// A running background shell keeps its output file open for writing.
async function liveness($: EngineInterface, output: string): Promise<Liveness> {
  try {
    const { exitCode, stdout, stderr } = await $.process.run(
      ['/usr/sbin/lsof', '-t', '-w', '--', output],
      { timeoutMs: 10_000 },
    )
    if (/\d/.test(stdout)) return 'alive'
    if (exitCode === 1 && stdout.trim() === '' && stderr.trim() === '') return 'gone'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

let isSyncingShells = false

// Agents the engine still counts as busy: queued, in a turn, or waiting on
// background work of their own.
async function syncAgents($: EngineInterface): Promise<void> {
  const agents = (await $.agent.list())
    .filter(a => a.status === 'pending' || a.status === 'running' || a.status === 'waiting')
    .map(a => a.id)
  const current = await read($, background)
  const same =
    agents.length === current.agents.length && agents.every(id => current.agents.includes(id))
  if (!same) await update($, background, b => ({ ...b, agents }))
}

// Refreshes each shell's last activity from its output file. A shell silent
// for a while is checked: alive counts as activity, gone drops it, and one
// that cannot be checked stays until the hard limit.
async function syncShells($: EngineInterface): Promise<void> {
  if (isSyncingShells) return
  isSyncingShells = true
  try {
    const current = await read($, background)
    if (current.shells.length === 0) return

    const now = await $.clock.now()
    const active = new Map<string, number>()
    const gone = new Set<string>()
    for (const shell of current.shells) {
      if (shell.output === undefined) continue
      let last = shell.lastActiveMs
      try {
        last = Math.max(last, (await $.fs.stat(shell.output)).mtimeMs)
      } catch {
        // No file (yet, or no longer): keep the last known activity.
      }
      if (now - last >= SHELL_SILENCE_MS) {
        const state = await liveness($, shell.output)
        if (state === 'alive') last = now
        if (state === 'gone') gone.add(shell.id)
      }
      active.set(shell.id, last)
    }

    await update($, background, b => ({
      ...b,
      shells: b.shells
        .filter(s => !gone.has(s.id))
        .map(s => ({ ...s, lastActiveMs: Math.max(s.lastActiveMs, active.get(s.id) ?? 0) }))
        .filter(s => now - s.lastActiveMs < SHELL_UNKNOWN_LIMIT_MS),
    }))
  } finally {
    isSyncingShells = false
  }
}

// Marks the call as waiting for the person for as long as `run` takes.
async function whileAsking<T>(
  $: EngineInterface,
  id: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (id === undefined) return run()
  await update($, background, b => ({ ...b, asking: [...(b.asking ?? []), id] }))
  try {
    return await run()
  } finally {
    await update($, background, b => ({ ...b, asking: (b.asking ?? []).filter(a => a !== id) }))
  }
}

function dropShells(b: Background, ids: readonly string[]): Background {
  return { ...b, shells: b.shells.filter(s => !ids.includes(s.id)) }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'busyline',
      description: 'Turn the train above the prompt on or off, or pick its theme',
      argumentHint: '[on|off|theme <name>]',
      immediate: true,
    })

    // An early version kept a debug trace of prompt snippets here.
    await $.store.delete('debug')

    // The engine's agent list is the authority: an agent whose turn ended
    // may still be waiting on background work of its own, and one that was
    // killed sends no turn.complete.
    $.clock.every(RECONCILE_MS, async () => {
      await syncAgents($)
      await syncShells($)
    })

    return next(e)
  })

  on('command.run', { command: 'busyline' }, async ($, e) => {
    const [arg = '', name] = e.args.trim().toLowerCase().split(/\s+/)

    if (arg === 'theme') {
      const names = Object.keys(THEMES).join(', ')
      if (name === undefined) {
        return { text: `Theme: ${await currentTheme($)}. Available: ${names}.` }
      }
      if (!Object.hasOwn(THEMES, name)) {
        return { text: `Unknown theme "${name}". Available: ${names}.` }
      }
      await $.store.set(THEME, name)
      $.ui.invalidate('ui.render')
      return { text: `Theme: ${name}.` }
    }

    const wasOn = (await $.store.get(ENABLED)) !== false
    const isOn = arg === 'on' ? true : arg === 'off' ? false : !wasOn

    await $.store.set(ENABLED, isOn)
    $.ui.invalidate('ui.render')

    return { text: isOn ? 'The train is rolling again.' : 'The train is back in the depot.' }
  })

  // The band's own `isWorking` prop follows the main turn. Subagents are
  // tracked by their own turns, background shells from launch to notice.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      $.ui.invalidate('ui.render')
    } else {
      const id = e.agentId
      await update($, background, b =>
        b.agents.includes(id) ? b : { ...b, agents: [...b.agents, id] },
      )
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      $.ui.invalidate('ui.render')
    } else {
      await syncAgents($)
    }
    return next(e)
  })

  // A shell sent to the background answers at once with its task id and
  // the file its output goes to.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    // A subagent's shell reports to that agent, which the agent list covers.
    if (e.agentId !== undefined) return ran
    const result = ran.result as
      | { backgroundTaskId?: string; backgroundEndsWithFinalResponse?: true }
      | undefined
    const id = result?.backgroundTaskId
    if (id !== undefined && !result?.backgroundEndsWithFinalResponse) {
      const output = /Output is being written to: (\S+?)\.?(?:\s|$)/.exec(ran.text ?? '')?.[1]
      const shell: Shell = { id, output, lastActiveMs: await $.clock.now() }
      await update($, background, b => {
        const rest = dropShells(b, [id])
        return { ...rest, shells: [...rest.shells, shell] }
      })
    }
    return ran
  })

  // A stopped shell sends no completion notice.
  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const ran = await next(e)
    const id = e.task_id ?? e.shell_id
    if (id !== undefined && !ran.isError) {
      await update($, background, b => dropShells(b, [id]))
    }
    return ran
  })

  // While the main loop waits for the person, the main turn is no work. The
  // call resolves once they answered (or the turn was interrupted).
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e, next) =>
    whileAsking($, e.agentId === undefined ? e.tool_use_id : undefined, () => next(e)),
  )
  on('tool.call', { tool: 'ExitPlanMode' }, ($, e, next) =>
    whileAsking($, e.agentId === undefined ? e.tool_use_id : undefined, () => next(e)),
  )

  // The notice arrives as a prompt of its own (not flagged meta), its text
  // naming the task; one notice may name several.
  on('prompt.submit', async ($, e, next) => {
    const ids = [...e.text.matchAll(/<task-id>([^<]+)<\/task-id>/g)].map(m => m[1] ?? '')
    if (ids.length > 0) {
      await update($, background, b => dropShells(b, ids))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    if ((await $.store.get(ENABLED)) === false) return next(e)

    const bg = { ...IDLE, ...(await read($, background)) }
    const isAsking = (bg.asking ?? []).length > 0
    const isWorking =
      (e.props.isWorking && !isAsking) || bg.agents.length > 0 || bg.shells.length > 0

    const name = await currentTheme($)

    if (e.surface === 'terminal') {
      const { Client } = $.ui.resolve(e)

      return (
        <Client key="train" module="./band.tsx" width="100%" props={{ isWorking, theme: name }} />
      )
    }

    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      const theme = themeOf(name)

      return (
        <Svg
          source={theme.svg(isWorking)}
          alt={theme.alt}
          width={theme.pxWidth}
          height={theme.pxHeight}
          isInteractive
        />
      )
    }

    return next(e)
  })
}
