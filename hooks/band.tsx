import type { ClientModule } from 'claude-code'

import { themeOf } from './themes'
import type { Style } from './themes/theme'

type Props = { isWorking: boolean; theme: string }
type State = { frame: number }

const TICK_MS = 50

let working = false

function sameStyle(a: Style, b: Style): boolean {
  return a.color === b.color && a.bg === b.bg && a.dim === b.dim
}

const Band: ClientModule<Props, State> = (props, surface) => {
  working = props.isWorking

  if (surface.state === undefined) {
    surface.setState({ frame: 0 })
    surface.every(TICK_MS, () => {
      if (!working) return
      const frame = surface.state?.frame ?? 0
      surface.setState({ frame: (frame + 1) % 1_000_000 })
    })
  }

  const frame = surface.state?.frame ?? 0
  const width = Math.max(surface.columns, 24)
  const grid = themeOf(props.theme).terminal(width, frame, props.isWorking)

  const { Box, Text } = surface.elements

  const rows = grid.map(cells => {
    const segments: Array<Style & { text: string }> = []
    for (const cell of cells) {
      const last = segments[segments.length - 1]
      if (last && sameStyle(last, cell)) {
        last.text += cell.ch
      } else {
        segments.push({ text: cell.ch, color: cell.color, bg: cell.bg, dim: cell.dim })
      }
    }
    return segments
  })

  return (
    <Box flexDirection="column" width="100%">
      {rows.map(segments => (
        <Box flexDirection="row">
          {segments.map(s => (
            <Text color={s.color} backgroundColor={s.bg} dimColor={s.dim} wrap="truncate">
              {s.text}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

export default Band
