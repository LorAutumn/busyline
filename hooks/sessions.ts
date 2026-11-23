import type { EngineInterface } from 'claude-code'

// The desktop app's session manager: it lists the sessions this one started
// with start_session and tells whether each is running.
const SERVER = 'ccd_session_mgmt'

// No more ids from start_session answers than this are kept.
export const MAX_CHECKED = 20

// A session's id: `local_…` on the person's computer, `session_…` in the
// cloud. start_session's answer also carries the word `session_id`.
const SESSION_ID = /\b(?:local|session)_(?!id\b)[A-Za-z0-9][A-Za-z0-9_-]*/g

type Result = { content: ReadonlyArray<{ type: string; text?: string }>; isError?: boolean }

// What the mod reads of a session as list_sessions and get_session answer.
type Row = {
  sessionId?: unknown
  title?: unknown
  isRunning?: unknown
  isArchived?: unknown
  startedBy?: unknown
}

function textOf(result: Result): string {
  return result.content.map(block => (block.type === 'text' ? (block.text ?? '') : '')).join('\n')
}

export function sessionIds(text: string): string[] {
  return [...new Set(text.match(SESSION_ID) ?? [])]
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const isWorking = (row: Row) => row.isRunning === true && row.isArchived !== true

// This session's id in the app (`local_…`), which its children name as
// `startedBy`; the engine's own session id is another one. Asked once.
let selfId: string | undefined
async function appSelf($: EngineInterface): Promise<string | undefined> {
  if (selfId !== undefined) return selfId
  try {
    const result = await $.mcp.call(SERVER, 'get_session', { session_id: 'self' })
    if (result.isError) return undefined
    const row = parse(textOf(result)) as Row | undefined
    if (typeof row?.sessionId === 'string') selfId = row.sessionId
  } catch {
    // Not known yet: asked again next time.
  }
  return selfId
}

// The app reads a session that waits for the person (a permission, a
// question) as running; ListAgents tells them apart: `waiting`, by title.
// Empty when ListAgents cannot be asked.
async function waitingTitles($: EngineInterface): Promise<Set<string>> {
  const waiting = new Set<string>()
  try {
    const ran = await $.tool.call({ tool: 'ListAgents' })
    const sections = (ran.result as { sections?: unknown } | undefined)?.sections
    if (!Array.isArray(sections)) return waiting
    for (const section of sections as { rows?: unknown }[]) {
      if (!Array.isArray(section.rows)) continue
      for (const row of section.rows as { name?: unknown; status?: unknown }[]) {
        if (typeof row.name === 'string' && row.status === 'waiting') waiting.add(row.name)
      }
    }
  } catch {
    // No ListAgents here: the app's word stands.
  }
  return waiting
}

export type Started = { listed: string[]; running: string[] }

// The sessions this one started, and which of them run now; undefined when
// the app cannot be asked (another surface, or the server is not connected).
// `known` are ids start_session answered with: asked about even when the
// list leaves them out (it may not name a new one yet).
export async function startedSessions(
  $: EngineInterface,
  known: readonly string[] = [],
): Promise<Started | undefined> {
  // Only this session's family: whoever started it, its siblings and its
  // children. The plain list names every session of the person.
  let rows: Row[]
  try {
    const result = await $.mcp.call(SERVER, 'list_sessions', { linked: true })
    if (result.isError) return undefined
    const parsed = parse(textOf(result)) // "No other sessions found." is none
    rows = Array.isArray(parsed) ? (parsed as Row[]) : []
  } catch {
    return undefined
  }
  if (rows.length === 0 && known.length === 0) return { listed: [], running: [] }

  const self = await appSelf($)
  const children = rows.filter(
    (row): row is Row & { sessionId: string } =>
      typeof row.sessionId === 'string' && self !== undefined && row.startedBy === self,
  )
  const listed = new Set(children.map(row => row.sessionId))
  const working: Row[] = children.filter(isWorking)

  for (const id of known) {
    if (listed.has(id) || id === self) continue
    listed.add(id)
    try {
      const result = await $.mcp.call(SERVER, 'get_session', { session_id: id })
      if (result.isError) continue
      const row = parse(textOf(result)) as Row | undefined
      if (row !== undefined && isWorking(row)) working.push({ ...row, sessionId: id })
    } catch {
      // Unreadable: not counted as work.
    }
  }

  const waiting = working.length > 0 ? await waitingTitles($) : new Set<string>()
  const running = working
    .filter(row => !(typeof row.title === 'string' && waiting.has(row.title)))
    .map(row => row.sessionId as string)
  return { listed: [...listed], running }
}
