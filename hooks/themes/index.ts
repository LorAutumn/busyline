import { theme as custom } from './custom'
import { theme as railcar } from './railcar'
import type { Theme } from './theme'

// Every theme the band can draw. The runtime loads only static imports, so
// a theme is listed here rather than discovered. `custom` is a slot for a
// theme of your own: see the README.
export const THEMES: Readonly<Record<string, Theme>> = { railcar, custom }

export const DEFAULT_THEME = 'railcar'

export function themeOf(name: string): Theme {
  return (Object.hasOwn(THEMES, name) ? THEMES[name] : undefined) ?? railcar
}
