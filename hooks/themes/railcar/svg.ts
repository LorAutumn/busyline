// The desktop railcar: a vector side view in the same look as the terminal's
// block version, face to the right, flush with the left edge so the rear runs
// off-screen. Sleepers and wind lines animate (SMIL) only while moving.

// The drawing is laid out in these units and shown at PX_HEIGHT pixels high;
// `slice` keeps that scale whatever the box's width, cropping on the right.
const WIDTH = 1400
const HEIGHT = 60
export const PX_HEIGHT = 50
export const PX_WIDTH = Math.round((WIDTH * PX_HEIGHT) / HEIGHT)

const BODY = '#8a8f98'
const WINDOW = '#3a3f48'
const GLASS = '#3b4a66'
const SKIRT = '#6f747c'
const DOOR_LINE = '#6f747c'
const RAIL = '#5e636b'
const TIE = '#8a8f98'
const WIND = '#555b66'

// The body spans y 10..50: the window band in its upper half, the skirt
// along the bottom fifth.
const TOP = 10
const BOTTOM = 50
const FACE = 420 // the front face's x
const RADIUS = 14 // its rounded corners
const DOOR_X = 196
const DOOR_W = 36

function windowBand(): string {
  const parts: string[] = []
  for (let x = 12; x + 30 < FACE - 44; x += 38) {
    if (x + 30 > DOOR_X - 6 && x < DOOR_X + DOOR_W + 6) continue
    parts.push(`<rect x="${x}" y="19" width="32" height="11" fill="${WINDOW}"/>`)
  }
  return parts.join('')
}

function door(): string {
  const half = DOOR_W / 2
  const lines = [0, half, DOOR_W]
    .map(
      dx =>
        `<line x1="${DOOR_X + dx}" y1="${TOP + 2}" x2="${DOOR_X + dx}" y2="${BOTTOM}" stroke="${DOOR_LINE}" stroke-width="1.5"/>`,
    )
    .join('')
  const panes = [4, half + 4]
    .map(dx => `<rect x="${DOOR_X + dx}" y="19" width="${half - 8}" height="11" fill="${WINDOW}"/>`)
    .join('')
  return lines + panes
}

function sleepers(moving: boolean): string {
  const parts: string[] = []
  for (let x = 0; x < WIDTH + 40; x += 40) {
    parts.push(`<rect x="${x}" y="54" width="12" height="4" fill="${TIE}"/>`)
  }
  const anim = moving
    ? '<animateTransform attributeName="transform" type="translate" from="0 0" to="-40 0" dur="0.22s" repeatCount="indefinite"/>'
    : ''
  return `<g>${anim}${parts.join('')}</g>`
}

function wind(moving: boolean): string {
  if (!moving) return ''
  const rows = [
    { y: 18, dash: '90 150', dur: '0.55s' },
    { y: 38, dash: '60 190', dur: '0.7s' },
  ]
  return rows
    .map(
      ({ y, dash, dur }) =>
        `<line x1="${FACE + 30}" y1="${y}" x2="${WIDTH + 400}" y2="${y}" stroke="${WIND}" stroke-width="2" stroke-dasharray="${dash}">` +
        `<animateTransform attributeName="transform" type="translate" from="0 0" to="-240 0" dur="${dur}" repeatCount="indefinite"/></line>`,
    )
    .join('')
}

export function svg(moving: boolean): string {
  // Flat roof and floor, a blunt face rounded at both corners.
  const body =
    `M0,${TOP} H${FACE - RADIUS} Q${FACE},${TOP} ${FACE},${TOP + RADIUS} ` +
    `V${BOTTOM - RADIUS} Q${FACE},${BOTTOM} ${FACE - RADIUS},${BOTTOM} H0 Z`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PX_WIDTH}" height="${PX_HEIGHT}" ` +
    `viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="xMinYMid slice">` +
    `<defs><clipPath id="body"><path d="${body}"/></clipPath></defs>` +
    `<line x1="0" y1="53" x2="${WIDTH}" y2="53" stroke="${RAIL}" stroke-width="2"/>` +
    sleepers(moving) +
    wind(moving) +
    `<path d="${body}" fill="${BODY}"/>` +
    `<rect x="0" y="42" width="${FACE}" height="8" fill="${SKIRT}" clip-path="url(#body)"/>` +
    windowBand() +
    door() +
    `<rect x="${FACE - 38}" y="16" width="30" height="15" rx="4" fill="${GLASS}"/>` +
    `</svg>`
  )
}
