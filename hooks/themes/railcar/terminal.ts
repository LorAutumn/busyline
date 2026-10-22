import { canvas, rails, streak } from '../theme'
import type { Cell } from '../theme'

// Muted palette: everything pulled about halfway towards a dark background,
// so the train sits on the screen like a watermark.
const BODY = '#8a8f98'
const WINDOW = '#3a3f48'
const GLASS = '#3b4a66'
const SKIRT = '#6f747c'
const DOOR_LINE = '#6f747c'
const STREAK = '#555b66'

const FRONT = 3 // cab cells past the body: windscreen and rounded face
const PILLAR = 6 // a pillar cell in the window band every this many cells
const MAX_LENGTH = 64 // body cells, the rest of the width is air

// A double door: three outlines around two leaves of two cells each.
const DOOR = [0, 3, 6]

export function terminal(width: number, frame: number, moving: boolean): Cell[][] {
  const { rows, put } = canvas(width, 3)

  const length = Math.min(MAX_LENGTH, width - FRONT - 10)
  const door = Math.floor(length / 2) - 3
  const isDoor = (x: number) => x >= door && x <= door + 6

  // Upper row: the body flush with the left edge so the rear runs off the
  // screen, a window band in its lower half broken by thin pillars.
  for (let x = 0; x < length; x++) {
    const isPillar = x < 2 || x % PILLAR === 0 || x >= length - 3
    put(0, x, isPillar || isDoor(x) ? ' ' : '▄', { color: WINDOW, bg: BODY })
  }
  for (const d of DOOR) put(0, door + d, '│', { color: DOOR_LINE, bg: BODY })
  for (const d of [1, 4]) {
    put(0, door + d, '▗', { color: WINDOW, bg: BODY })
    put(0, door + d + 1, '▖', { color: WINDOW, bg: BODY })
  }

  // Lower row: the skirt, a shade darker, along the lower half; the door
  // leaves reach down to the floor.
  for (let x = 0; x < length + FRONT - 1; x++) {
    put(1, x, isDoor(x) ? ' ' : '▄', { color: SKIRT, bg: BODY })
  }
  for (const d of DOOR) put(1, door + d, '│', { color: DOOR_LINE, bg: BODY })

  // The cab: a wide windscreen and a blunt face rounded at both corners.
  put(0, length, '▄', { color: GLASS, bg: BODY })
  put(0, length + 1, '▄', { color: GLASS, bg: BODY })
  put(0, length + 2, '▖', { color: BODY })
  put(1, length + 2, '▛', { color: BODY })

  rails(put, 2, width, moving ? frame : 0)

  // Two wind lines ahead of the face, each with its own rhythm and speed,
  // both faster than the sleepers.
  if (moving) {
    for (let x = length + FRONT + 2; x < width; x++) {
      if (streak(x + frame * 3, 23, 7)) put(0, x, '─', { color: STREAK, dim: true })
      if (streak(x + frame * 2 + 9, 17, 5)) put(1, x, '─', { color: STREAK, dim: true })
    }
  }

  return rows
}
