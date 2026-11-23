import type { EngineInterface } from 'claude-code'

// Claude Code Remote: a cloud session starts its children there
// (create_session) and reads how each stands from get_session's
// `status_bucket`: working, blocked (on the person), completed or failed.
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

// The session a create_session answer names: a JSON answer's `id`,
// `session_id` or `sessionId` (its own, or its `session`'s), else the ids
// its text holds.
export function remoteIds(answer: unknown): string[] {
  const value = typeof answer === 'string' ? (parse(answer) ?? answer) : answer
  if (isRecord(value)) {
    for (const holder of [value, value.session]) {
      if (!isRecord(holder)) continue
      for (const key of ['session_id', 'sessionId', 'id']) {
        const id = holder[key]
        if (typeof id === 'string' && id !== '') return [id]
      }
    }
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return [...new Set(text.match(ID_IN_TEXT) ?? [])]
}

function bucketOf(text: string): string | undefined {
  const value = parse(text)
  if (isRecord(value)) {
    for (const holder of [value, value.session]) {
      if (isRecord(holder) && typeof holder.status_bucket === 'string') return holder.status_bucket
    }
  }
  return /\bstatus_bucket\b["']?\s*[:=]\s*["']?([a-z_]+)/.exec(text)?.[1]
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
  const running: string[] = []
  const watched: string[] = []
  let answered = 0
  for (const id of ids) {
    let bucket: string | undefined
    try {
      const result = await $.mcp.call(SERVER, 'get_session', { session_id: id })
      if (!result.isError) {
        answered += 1
        bucket = bucketOf(textOf(result))
      }
    } catch {
      // Unreadable now: asked again next time.
    }
    if (bucket === 'completed' || bucket === 'failed') continue
    watched.push(id)
    if (bucket === 'working') running.push(id)
  }
  return answered === 0 && ids.length > 0 ? undefined : { running, watched }
}
