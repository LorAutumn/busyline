# busyline

A small train above the Claude Code prompt that rolls while Claude works and
stands still while it waits for you.

It counts as work: the main turn, subagents still running, and shells sent to
the background, until they finish or go quiet. While a question or a plan
waits for your answer, the train stops. It is drawn as block characters in
the terminal and as an animated SVG in the desktop app, in muted colours so it
sits on the screen like a watermark.

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
