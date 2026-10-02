import { darkTokens, lightTokens } from '../../utils/themeTokens'

export function contrast(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255)
      .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
    return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722
  }
  const a = luminance(foreground), b = luminance(background)
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
}

export function themeContrasts() {
  const pairs: [keyof typeof lightTokens, keyof typeof lightTokens, number][] = []
  for (const background of ['bg', 'surface'] as const) {
    for (const foreground of ['text', 'text-secondary', 'text-muted'] as const) pairs.push([foreground, background, 4.5])
  }
  pairs.push(['primary-fg', 'orange', 4.5], ['primary-fg', 'orange-hover', 4.5], ['blue', 'surface', 4.5], ['blue-hover', 'surface', 4.5], ['accent-fg', 'blue', 4.5], ['error-fg', 'error-text', 4.5], ['border', 'surface', 3], ['control-border', 'surface', 3])
  pairs.push(['tooltip-fg', 'tooltip-bg', 4.5], ['tooltip-muted', 'tooltip-bg', 4.5], ['tooltip-link', 'tooltip-bg', 4.5], ['help-text', 'help-bg', 4.5], ['panel-muted', 'panel-soft', 4.5], ['message-text', 'info-bg', 4.5])
  for (const name of ['success', 'warning', 'error', 'info', 'neutral', 'purple', 'pink', 'gold', 'indigo'] as const) pairs.push([`${name}-text`, `${name}-bg`, 4.5])
  return (['light', 'dark'] as const).flatMap(theme => pairs.map(([foreground, background, minimum]) => {
    const tokens = theme === 'light' ? lightTokens : darkTokens
    return { id: `${theme}:${foreground}/${background}`, theme, foreground, background, minimum, ratio: contrast(tokens[foreground], tokens[background]) }
  }))
}
