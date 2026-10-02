/** HU-ERD-161: los valores claros conservan la paleta original. */
export const lightTokens = {
  bg: '#F5F8FA', surface: '#FFFFFF', border: '#CBD6E2', 'border-light': '#E5EAF0',
  text: '#33475B', 'text-secondary': '#516F90', 'text-muted': '#8DA1B5',
  orange: '#FF7A59', 'orange-hover': '#E66E50', blue: '#0091AE', 'blue-bg': '#EAF3F6',
  navy: '#213343', 'sidebar-active-bg': '#EAF0F6',
  'success-bg': '#CCF1DE', 'success-text': '#0A7A4F', 'warning-bg': '#FEF0D2', 'warning-text': '#B3720A',
  'error-bg': '#FBE0DD', 'error-text': '#C7391F', 'info-bg': '#E5F5F8', 'info-text': '#0091AE',
  'neutral-bg': '#EAF0F6', 'neutral-text': '#516F90', 'purple-bg': '#EDE7FB', 'purple-text': '#6D3FC4',
  'pink-bg': '#FCE4EF', 'pink-text': '#C42B7A', 'gold-bg': '#FBF3D9', 'gold-text': '#8C6D14',
  'indigo-bg': '#E0E7FF', 'indigo-text': '#4338CA',
  'primary-fg': '#FFFFFF', 'accent-fg': '#FFFFFF', 'error-fg': '#FFFFFF',
  'control-border': '#CBD6E2', 'switch-thumb': '#FFFFFF',
  'panel-soft': '#FDFEFE', 'panel-border': '#D9E2EB', 'panel-muted': '#718096',
  'help-bg': '#EAF7F9', 'help-hover': '#D9F0F4', 'help-border': '#B9DCE4', 'help-text': '#006E84',
  'message-border': '#CDEBF0', 'message-text': '#214E59', 'panel-hover': '#EDF3F6',
  'dashboard-soft': '#F8FAFC', 'blue-hover': '#007F98', 'shortcut-border': '#9FCBD5',
  'shortcut-arrow': '#B1BFCC', 'table-divider': '#E5E7EB', 'scrollbar': '#CBD5E1',
  'usage-warning': '#985E08', 'usage-link': '#007C95', 'tooltip-muted': '#D7E0E8', 'tooltip-link': '#7FD8EE',
  'body-bg': '#F9FAFB', 'body-text': '#111827', 'spinner-track': '#CFE4E9',
  'skeleton-base': '#EDF1F4', 'skeleton-highlight': '#F7F9FA', 'dashboard-focus': '#71BDCD',
  'dashboard-error-border': '#EFB8B0', 'dashboard-error-hover': '#A9321C', 'filter-hover': '#DCECF1',
  'tooltip-bg': '#33475B', 'tooltip-fg': '#FFFFFF', 'overlay': '#213343', 'shadow': '#33475B',
  'kanban-column': '#EEF2F7', 'kanban-focus': '#8FC8D4', 'kanban-divider': '#EDF1F5',
  'stage-cyan': '#00A4BD', 'stage-purple': '#6A5ACD', 'mention-hover': '#007A91',
  'activity-error': '#B42318', 'origin-border': '#DBE8EC', 'origin-bg': '#F5FAFB',
  'app-pending-text': '#B45309', 'app-pending-dot': '#D97706', 'modal-overlay': '#000000'
} as const

export const darkTokens: Record<keyof typeof lightTokens, string> = {
  bg: '#141B29', surface: '#1E2A3D', border: '#3A4A5E', 'border-light': '#2C374A',
  text: '#F0F4F8', 'text-secondary': '#9FB3C8', 'text-muted': '#7A8CA0',
  orange: '#FF8F6B', 'orange-hover': '#FFA184', blue: '#3FC3DE', 'blue-bg': '#0F3A44',
  navy: '#F0F4F8', 'sidebar-active-bg': '#2A3648',
  'success-bg': '#123D2A', 'success-text': '#4ADE94', 'warning-bg': '#402D0A', 'warning-text': '#F5B94D',
  'error-bg': '#3D1712', 'error-text': '#FF8A76', 'info-bg': '#0F2E36', 'info-text': '#4DD0E1',
  'neutral-bg': '#2A3648', 'neutral-text': '#AEC0D2', 'purple-bg': '#2A2140', 'purple-text': '#C4A7FF',
  'pink-bg': '#3A1F2C', 'pink-text': '#FF9CCC', 'gold-bg': '#352C16', 'gold-text': '#E8CB73',
  'indigo-bg': '#252B4B', 'indigo-text': '#B7BFFF',
  'primary-fg': '#1A2233', 'accent-fg': '#1A2233', 'error-fg': '#1A2233',
  'control-border': '#7A8CA0', 'switch-thumb': '#FFFFFF',
  'panel-soft': '#1E2A3D', 'panel-border': '#3A4A5E', 'panel-muted': '#9FB3C8',
  'help-bg': '#0F3A44', 'help-hover': '#174853', 'help-border': '#3FC3DE', 'help-text': '#4DD0E1',
  'message-border': '#3A4A5E', 'message-text': '#AEC0D2', 'panel-hover': '#2A3648',
  'dashboard-soft': '#141B29', 'blue-hover': '#4DD0E1', 'shortcut-border': '#3FC3DE',
  'shortcut-arrow': '#9FB3C8', 'table-divider': '#3A4A5E', 'scrollbar': '#3A4A5E',
  'usage-warning': '#F5B94D', 'usage-link': '#3FC3DE', 'tooltip-muted': '#9FB3C8', 'tooltip-link': '#3FC3DE',
  'body-bg': '#141B29', 'body-text': '#F0F4F8', 'spinner-track': '#3A4A5E',
  'skeleton-base': '#2C374A', 'skeleton-highlight': '#3A4A5E', 'dashboard-focus': '#3FC3DE',
  'dashboard-error-border': '#FF8A76', 'dashboard-error-hover': '#FFA99A', 'filter-hover': '#174853',
  'tooltip-bg': '#1E2A3D', 'tooltip-fg': '#F0F4F8', 'overlay': '#000000', 'shadow': '#000000',
  'kanban-column': '#141B29', 'kanban-focus': '#3FC3DE', 'kanban-divider': '#2C374A',
  'stage-cyan': '#4DD0E1', 'stage-purple': '#C4A7FF', 'mention-hover': '#4DD0E1',
  'activity-error': '#FF8A76', 'origin-border': '#3A4A5E', 'origin-bg': '#141B29',
  'app-pending-text': '#F5B94D', 'app-pending-dot': '#F5B94D', 'modal-overlay': '#000000'
}

export function rgbChannels(hex: string): string {
  return [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)).join(' ')
}

export const brandColors = Object.fromEntries(Object.keys(lightTokens).map(name => [name, `rgb(var(--brand-${name}) / <alpha-value>)`]))
