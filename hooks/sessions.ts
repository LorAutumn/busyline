import type { EngineInterface } from 'claude-code'

// The desktop app's session manager: it lists the sessions this one started
// with start_session and tells whether each is running.
const SERVER = 'ccd_session_mgmt'

// No more sessions than this are asked about in one check.
export const MAX_CHECKED = 20

// A session's id: `local_…` on the person's computer, `session_…` in the cloud.
const SESSION_ID = /\b(?:local|session)_[A-Za-z0-9][A-Za-z0-9_-]*/g

function textOf(result: { content: ReadonlyArray<{ type: string; text?: string }> }): string {
  return result.content.map(block => (block.type === 'text' ? (block.text ?? '') : '')).join('\n')
}

export function sessionIds(text: string): string[] {
  return [...new Set(text.match(SESSION_ID) ?? [])]
}

export type Started = { listed: string[]; running: string[] }

// The sessions this one started, and which of them run now; undefined when
// the app cannot be asked (another surface, or the server is not connected).
// `known` are ids start_session answered with: asked about even when the
// list leaves them out.
export async function startedSessions(
  $: EngineInterface,
  known: readonly string[] = [],
): Promise<Started | undefined> {
  let listed: string
  try {
    const result = await $.mcp.call(SERVER, 'list_sessions', {})
    if (result.isError) return undefined
    listed = textOf(result)
  } catch {
    return undefined
  }

  const self = await $.session.id()
  const ids = [...new Set([...known, ...sessionIds(listed)])]
    .filter(id => id !== self)
    .slice(-MAX_CHECKED)

  const running: string[] = []
  for (const id of ids) {
    try {
      const result = await $.mcp.call(SERVER, 'get_session', { session_id: id })
      if (result.isError) continue
      const session = JSON.parse(textOf(result)) as { isRunning?: unknown; isArchived?: unknown }
      if (session.isRunning === true && session.isArchived !== true) running.push(id)
    } catch {
      // Unreadable: not counted as work.
    }
  }
  return { listed: ids, running }
}
