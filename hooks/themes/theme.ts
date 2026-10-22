// What a theme draws and the small kit the bundled themes draw with.

export type Style = { color?: string; bg?: string; dim?: boolean }
export type Cell = Style & { ch: string }

export type Theme = {
  // The terminal band: rows of exactly `width` cells. `frame` advances by
  // one every tick while `moving`, and stays put otherwise.
  terminal: (width: number, frame: number, moving: boolean) => Cell[][]
  // The desktop band: a standalone SVG document, animated while `moving`.
  svg: (moving: boolean) => string
  pxWidth: number
  pxHeight: number
  alt: string
}

const RAIL = '#5e636b'

export type Put = (row: number, x: number, ch: string, style?: Style) => void

// A blank grid and a writer that ignores cells off the grid.
export function canvas(width: number, height: number): { rows: Cell[][]; put: Put } {
  const rows = Array.from({ length: height }, () =>
    Array.from({ length: width }, (): Cell => ({ ch: ' ' })),
  )
  const put: Put = (row, x, ch, style = {}) => {
    const line = rows[row]
    if (!line || x < 0 || x >= width) return
    line[x] = { ch, ...style }
  }
  return { rows, put }
}

// Air passing the train: deterministic runs whose periods do not line up
// with each other or the sleepers, so the layers slide past each other.
export function streak(worldX: number, period: number, length: number): boolean {
  const t = ((worldX % period) + period) % period
  return t < length
}

// Rails: a thin line with a sleeper hanging below every fourth cell, sliding
// left one cell per frame.
export function rails(put: Put, row: number, width: number, offset: number): void {
  for (let x = 0; x < width; x++) {
    const tie = (x + offset) % 4 === 0
    put(row, x, tie ? '╤' : '═', { color: RAIL, dim: !tie })
  }
}
