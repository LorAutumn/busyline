import type { EngineInterface } from 'claude-code'

// Claude Code Remote: a cloud session starts its children there
// (create_session) and reads how each stands from get_session's
// `status_bucket`. Both answer one JSON object under `ccr`, as seen in a
// cloud session: `{"ccr":{"id":"session_…","parent_session_id":"session_…",
// "status_bucket":"SESSION_STATUS_BUCKET_WORKING",…}}`; a finished one reads
// `…_COMPLETED`. Blocked (on the person) and failed are named likewise.
const SERVER = 'claude-code-remote'

type Result = { content: ReadonlyArray<{ type: string; text?: string }>; isError?: boolean }

function textOf(result: Result): string {
  return result.content.map(block => (block.type === 'text' ? (block.text ?? '') : '')).join('\n')
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// An id in running text: `session_` and a long tail, which the word
// `session_id` is not.
const ID_IN_TEXT = /\bsession_[A-Za-z0-9][A-Za-z0-9-]{7,}\b/g

// The answer as the object it holds: itself, the JSON its text is, or the
// JSON an MCP result's text blocks are; a text that is no JSON stays text.
function opened(answer: unknown): unknown {
  if (typeof answer === 'string') return parse(answer) ?? answer
  if (isRecord(answer) && Array.isArray(answer.content)) {
    return opened(textOf(answer as unknown as Result))
  }
  return answer
}

// Where an answer keeps the session: under `ccr`, under `session`, or flat.
function holders(value: Record<string, unknown>): Record<string, unknown>[] {
  return [value.ccr, value.session, value].filter(isRecord)
}

// The session a create_session answer names: its `id` (or `session_id`,
// `sessionId`). An object that names none names no session: the other ids
// in it are not the new one (`parent_session_id` is this very session).
// Only an answer in plain text is searched for ids.
export function remoteIds(answer: unknown): string[] {
  const value = opened(answer)
  if (isRecord(value)) {
    for (const holder of holders(value)) {
      for (const key of ['id', 'session_id', 'sessionId']) {
        const id = holder[key]
        if (typeof id === 'string' && id !== '') return [id]
      }
    }
    return []
  }
  return typeof value === 'string' ? [...new Set(value.match(ID_IN_TEXT) ?? [])] : []
}

// `SESSION_STATUS_BUCKET_WORKING` and `working` alike read `working`.
const bucketName = (raw: string) => raw.replace(/^SESSION_STATUS_BUCKET_/i, '').toLowerCase()

type Standing = { bucket?: string; parent?: string }

function standingOf(text: string): Standing {
  const value = parse(text)
  if (isRecord(value)) {
    for (const holder of holders(value)) {
      if (typeof holder.status_bucket !== 'string') continue
      const parent = holder.parent_session_id
      return { bucket: bucketName(holder.status_bucket), parent: typeof parent === 'string' ? parent : undefined }
    }
    return {}
  }
  const raw = /\bstatus_bucket\b["']?\s*[:=]\s*["']?([A-Za-z_]+)/.exec(text)?.[1]
  return { bucket: raw === undefined ? undefined : bucketName(raw) }
}

// `running` work now; `watched` are those still to ask about: all but the
// completed and the failed (a blocked one may be set to work again).
export type Remote = { running: string[]; watched: string[] }

// How the sessions `ids` stand; undefined when none could be asked about
// (no such server here, or it is out of reach).
export async function remoteSessions(
  $: EngineInterface,
  ids: readonly string[],
): Promise<Remote | undefined> {
  const standings = new Map<string, Standing>()
  let answered = 0
  for (const id of ids) {
    try {
      const result = await $.mcp.call(SERVER, 'get_session', { session_id: id })
      if (!result.isError) {
        answered += 1
        standings.set(id, standingOf(textOf(result)))
      }
    } catch {
      // Unreadable now: asked again next time.
    }
  }
  if (answered === 0 && ids.length > 0) return undefined
  // A session that started one of the others is this one itself, or one
  // above it: never its own child.
  const parents = new Set([...standings.values()].map(s => s.parent))
  const running: string[] = []
  const watched: string[] = []
  for (const id of ids) {
    const bucket = standings.get(id)?.bucket
    if (parents.has(id) || bucket === 'completed' || bucket === 'failed') continue
    watched.push(id)
    if (bucket === 'working') running.push(id)
  }
  return { running, watched }
}
