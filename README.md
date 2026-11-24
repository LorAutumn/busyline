# busyline

A small train above the Claude Code prompt that rolls while Claude works and
stands still while it waits for you.

It counts as work: the main turn, subagents still running, shells sent to
the background, until they finish or go quiet, and sessions this one
started that are still working. While a question or a plan waits for your
answer, the train stops. It is drawn as block characters in
the terminal and as an animated SVG in the desktop app, in muted colours so it
sits on the screen like a watermark.

## Sessions started from this one

The train keeps rolling after the main turn has ended while a session this
one started is still working, and stands while that session waits for you.

- **Desktop app.** After a `start_session` or a message to a session, the mod
  asks the app every 10 seconds which of the sessions this one started are
  running. Only those count: your other sessions, the one that started this
  one and its siblings do not. A session waiting for a permission or an
  answer does not count either. The asking ends once nothing started runs
  and begins again with the next start or message, so a conversation that
  starts no sessions costs one look at its start.
- **Cloud sessions.** Sessions started through Claude Code Remote
  (`create_session`, or written to with `send_message`) are asked about every
  10 seconds until they complete or fail. `working` counts as work, `blocked`
  does not: a session that waits for an answer or an approval is still asked
  about, since it can start working again, for up to six hours of waiting;
  after that only a message to it starts the asking again. The tests answer as that
  server did in a cloud session for a working, a blocked and a completed
  session; a failed one has not been seen there yet.

Things to know:

- The train may take up to 10 seconds to notice that a session started or
  finished working.
- Sessions a subagent starts are not followed.
- Whether a desktop session waits for you is read from the agent list, which
  names sessions by title. Two started sessions with the same title count as
  work as long as one of them is busy.
- While a permission dialog of the main session is open, the train keeps
  rolling: nothing tells a mod when the dialog is answered.

## Install

```
/plugin install busyline --marketplace LorAutumn/busyline
```

Answer `y` to add the marketplace, then pick a scope.

## Commands

| Command | What it does |
|---|---|
| `/busyline` | Toggle the train on or off |
| `/busyline on` / `/busyline off` | Turn it on or off |
| `/busyline theme` | Show the current theme and the ones available |
| `/busyline theme <name>` | Switch to a theme |

## Themes

`railcar` is the built-in theme. `custom` is a slot for a theme of your own;
out of the box it draws the railcar too.

### Write your own theme

The mod runtime loads only files imported statically, so a theme cannot be
discovered at run time. Instead, `hooks/themes/custom/` is a slot whose
contents stay on your machine:

1. Replace `hooks/themes/custom/index.ts` with a module that exports
   `theme: Theme` (see `hooks/themes/theme.ts`; `hooks/themes/railcar/` is a
   complete example). Helper files next to it are ignored by git.
2. Tell git to leave your version alone, and enable the repository's hooks:

   ```
   git update-index --skip-worktree hooks/themes/custom/index.ts
   git config core.hooksPath .githooks
   ```

3. `/busyline theme custom`

The pre-commit hook refuses commits that touch the slot, and the
`slot-guard` workflow checks that the repository only ever holds the stub.

## Development

```
claude --plugin-dir .        # run a session with the mod loaded
claude plugin test .         # tests
claude plugin validate .
```

## License

MIT
