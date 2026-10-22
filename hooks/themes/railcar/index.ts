import type { Theme } from '../theme'
import { PX_HEIGHT, PX_WIDTH, svg } from './svg'
import { terminal } from './terminal'

export const theme: Theme = {
  terminal,
  svg,
  pxWidth: PX_WIDTH,
  pxHeight: PX_HEIGHT,
  alt: 'A railcar that rolls while Claude works',
}
