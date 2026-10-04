import { agendaButtonContrast } from './publicAgendaRuntime'

export function normalizeAgendaAccent(value: unknown): string | null {
  if (typeof value !== 'string' || ![4, 7].includes(value.length) || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return null
  const hex = value.slice(1).toLowerCase()
  return `#${hex.length === 3 ? [...hex].map(char => char + char).join('') : hex}`
}
export const agendaAccentPresets = { primary: [0, 110, 132], secondary: [33, 51, 67], accent: [255, 122, 89] }
export function agendaAccentPresentation(accent: keyof typeof agendaAccentPresets | 'custom', color?: unknown) {
  const normalized = normalizeAgendaAccent(color)
  const rgb = accent === 'custom' ? normalized ? [1, 3, 5].map(index => parseInt(normalized.slice(index, index + 2), 16)) : null : agendaAccentPresets[accent]
  if (!rgb) return { css: '', foreground: 'black', ratio: 0, approved: false }
  const contrast = agendaButtonContrast(rgb)
  return { css: accent === 'custom' ? normalized! : `rgb(${rgb.join(' ')})`, ...contrast, approved: Number.isFinite(contrast.ratio) && contrast.ratio >= 4.5 }
}
