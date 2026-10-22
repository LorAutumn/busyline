// A background shell of the main session: its task id, the file its output
// goes to, and when that output last grew (or the shell started).
export type Shell = { id: string; output?: string; lastActiveMs: number }

// Work going on while the main turn is idle: subagents by id, and the
// background shells from their launch until their completion notice, a
// TaskStop, or a long silence in their output. `asking` holds the main
// loop's tool calls that wait for the person (a question, a plan to approve).
export type Background = { agents: string[]; shells: Shell[]; asking?: string[] }

declare module 'claude-code' {
  interface PluginState {
    busyline: { busy: Background }
  }
}
