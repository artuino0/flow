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

/** HU-171: interfaz fiscal y planes; la factura impresa no participa. */
export const billingContrastPairs: [keyof typeof lightTokens, keyof typeof lightTokens, number][] = [
  ['cfdi-form-secondary', 'surface', 4.5],
  ['cfdi-form-success-text', 'cfdi-form-success-bg', 4.5],
  ['cfdi-form-success-text', 'surface', 4.5],
  ['cfdi-form-warning', 'surface', 4.5],
  ['sites-muted', 'cfdi-selected-bg', 4.5],
  ['text', 'cfdi-selected-bg', 4.5],
  ['blue', 'cfdi-selected-bg', 4.5],
  ['primary-fg', 'cfdi-form-primary-hover', 4.5],
  ['sites-archived-text', 'cfdi-form-error-bg', 4.5],
  ['cfdi-add-border', 'surface', 3],
  ['cfdi-secondary', 'surface', 4.5],
  ['cfdi-secondary', 'cfdi-environment-bg', 4.5],
  ['cfdi-secondary', 'cfdi-draft-bg', 4.5],
  ['cfdi-muted', 'surface', 4.5],
  ['cfdi-label', 'surface', 4.5],
  ['cfdi-empty-text', 'surface', 4.5],
  ['cfdi-heading', 'surface', 4.5],
  ['cfdi-action-text', 'surface', 4.5],
  ['cfdi-action-text', 'bg', 4.5],
  ['cfdi-table-text', 'surface', 4.5],
  ['cfdi-link', 'surface', 4.5],
  ['cfdi-link', 'cfdi-quick-hover', 4.5],
  ['cfdi-link-hover', 'surface', 4.5],
  ['cfdi-icon', 'cfdi-icon-bg', 3],
  ['cfdi-stamped-text', 'cfdi-stamped-bg', 4.5],
  ['cfdi-error-text', 'cfdi-error-bg', 4.5],
  ['cfdi-stamping-text', 'cfdi-stamping-bg', 4.5],
  ['cfdi-cancelled-text', 'cfdi-cancelled-bg', 4.5],
  ['primary-fg', 'cfdi-primary', 4.5],
  ['primary-fg', 'cfdi-primary-hover', 4.5],
  ['cfdi-danger-text', 'surface', 4.5],
  ['cfdi-danger-text', 'cfdi-danger-hover', 4.5],
  ['cfdi-alert-error-text', 'cfdi-alert-error-bg', 4.5],
  ['error-fg', 'cfdi-alert-error-icon', 4.5],
  ['cfdi-alert-info-text', 'cfdi-alert-info-bg', 4.5],
  ['cfdi-alert-info-icon-text', 'cfdi-alert-info-icon-bg', 4.5],
  ['cfdi-alert-success-text', 'cfdi-alert-success-bg', 4.5],
  ['primary-fg', 'cfdi-alert-success-icon', 4.5],
  ['cfdi-action-border', 'surface', 3],
  ['cfdi-action-hover-border', 'cfdi-action-hover-bg', 3],
  ['cfdi-event-error', 'surface', 4.5],
  ['cfdi-alert-error-text', 'cfdi-load-error-bg', 4.5],
  ['label-muted', 'surface', 4.5],
  ['sites-muted', 'surface', 4.5],
  ['sites-muted', 'bg', 4.5],
  ['sites-muted', 'plan-page-bg', 4.5],
  ['text', 'plan-page-bg', 4.5],
  ['text-secondary', 'plan-page-bg', 4.5],
  ['tooltip-fg', 'plan-interval-bg', 4.5],
  ['blue', 'surface', 4.5],
  ['blue', 'blue-bg', 4.5],
  ['primary-fg', 'orange', 4.5],
  ['primary-fg', 'orange-hover', 4.5],
  ['error-fg', 'error-text', 4.5],
  ['success-text', 'surface', 4.5],
  ['success-text', 'success-bg', 4.5],
  ['error-text', 'error-bg', 4.5],
  ['control-border', 'surface', 3],
  ['text', 'surface', 4.5],
  ['text-secondary', 'surface', 4.5],
  ['blue', 'help-bg', 4.5],
  ['billing-warning-text', 'billing-warning-bg', 4.5],
  ['billing-error-text', 'billing-error-bg', 4.5],
  ['billing-info-text', 'billing-info-bg', 4.5],
]
export function isBillingContrast(result: { id?: string }) {
  return result.id?.includes(':billing:') ?? false
}

/** HU-170: superficies y estados que realmente usan triggers y cromo de reportes.
 * Papel aislado en claro; no se atribuye AA oscuro a la tinta impresa.
 */
export const automationReportContrastPairs: [keyof typeof lightTokens, keyof typeof lightTokens, number][] = [
  ['trigger-activation', 'surface', 4.5], ['trigger-hover-border', 'surface', 3],
  ['trigger-decision-border', 'surface', 3], ['trigger-yes-line', 'bg', 3],
  ['trigger-no-line', 'bg', 3], ['success-text', 'trigger-yes-bg', 4.5],
  ['trigger-no-text', 'trigger-no-bg', 4.5], ['trigger-no-text', 'surface', 4.5],
  ['sites-muted', 'neutral-bg', 4.5], ['sites-muted', 'blue-bg', 4.5],
  ['sites-muted', 'report-picker-bg', 4.5], ['text', 'report-picker-bg', 4.5],
  ['text-secondary', 'report-picker-bg', 4.5], ['control-border', 'report-picker-bg', 3],
  ['sites-muted', 'border-light', 4.5], ['accent-fg', 'blue', 4.5],
  ['orange', 'surface', 4.5], ['orange', 'surface', 3], ['orange', 'bg', 3],
  ['control-border', 'bg', 3], ['text', 'blue-bg', 4.5], ['text', 'neutral-bg', 4.5],
  ['primary-fg', 'orange', 4.5], ['primary-fg', 'orange-hover', 4.5],
  ['sites-muted', 'surface', 4.5], ['sites-muted', 'bg', 4.5],
  ['text-secondary', 'surface', 4.5], ['text-secondary', 'bg', 4.5],
  ['blue', 'blue-bg', 4.5], ['success-text', 'success-bg', 4.5],
  ['error-text', 'error-bg', 4.5], ['warning-text', 'warning-bg', 4.5],
  ['warning-text', 'surface', 4.5], ['purple-text', 'purple-bg', 4.5],
  ['info-text', 'info-bg', 4.5], ['pink-text', 'pink-bg', 4.5],
  ['control-border', 'surface', 3], ['blue', 'surface', 3]
]
// Una sección independiente permite congelar incluso los pares reutilizados
// sin cambiar la pertenencia de las auditorías anteriores.
export function isAutomationReportContrast(result: { id: string }) {
  return result.id.includes(':automation-report:')
}

/** Lista cerrada del editor HU-164; sus déficits claros se autorizan aparte de los 17 originales. */
export const labelContrastPairs: [keyof typeof lightTokens, keyof typeof lightTokens, number][] = [
  ['label-muted', 'surface', 4.5], ['label-heading', 'surface', 4.5],
  ['label-label', 'surface', 4.5], ['label-control-text', 'surface', 4.5],
  ['label-section', 'surface', 4.5], ['label-secondary', 'surface', 4.5],
  ['label-selected-text', 'label-selected-bg', 4.5], ['label-icon', 'surface', 4.5],
  ['label-ink', 'surface', 4.5], ['label-paper-muted', 'surface', 4.5],
  ['label-control-border', 'surface', 3], ['label-focus', 'surface', 3],
  ['label-toggle-bg', 'surface', 3], ['label-toggle-active', 'surface', 3]
]
export function isLabelContrast(result: { foreground: string; background: string; id?: string }) {
  if (result.id?.includes(':automation-report:') || isBillingContrast(result)) return false
  return labelContrastPairs.some(([foreground, background]) => foreground === result.foreground && background === result.background)
}

/** BUG-166: foco y marca del divisor, incluidos sus fondos de interacción reales. */
export const resizeContrastPairs: [keyof typeof lightTokens, keyof typeof lightTokens, number][] = [
  ['blue', 'resize-hover', 3], ['blue', 'resize-bg', 3], ['blue', 'surface', 3],
  ['resize-mark', 'resize-hover', 3], ['resize-mark', 'resize-bg', 3]
]
export function isResizeContrast(result: { foreground: string; background: string; id?: string }) {
  if (result.id?.includes(':automation-report:') || isBillingContrast(result)) return false
  return result.foreground.startsWith('resize-') || result.background.startsWith('resize-')
}

/** HU-167: pares reales de Sites; claros originales medidos sin corregirlos ni ocultarlos. */
export const sitesContrastPairs: [keyof typeof lightTokens, keyof typeof lightTokens, number][] = [
  ['sites-muted', 'surface', 4.5], ['sites-muted', 'bg', 4.5],
  ['sites-muted', 'designer-section-bg', 4.5], ['sites-muted', 'dashboard-soft', 4.5],
  ['sites-muted', 'sites-row-hover', 4.5], ['sites-icon', 'surface', 4.5],
  ['sites-icon', 'bg', 4.5], ['sites-icon', 'kanban-divider', 3],
  ['primary-fg', 'sites-primary-hover', 4.5],
  ['sites-published-text', 'sites-published-bg', 4.5],
  ['sites-archived-text', 'sites-archived-bg', 4.5], ['sites-archived-text', 'surface', 4.5],
  ['text', 'sites-row-hover', 4.5], ['text-secondary', 'sites-row-hover', 4.5],
  ['text', 'sites-action-hover', 4.5], ['text-secondary', 'sites-draft-bg', 4.5],
  ['text-secondary', 'kanban-divider', 4.5], ['sites-warning-text', 'sites-warning-bg', 4.5],
  ['sites-feedback-text', 'blue-bg', 4.5], ['sites-saved', 'bg', 4.5],
  ['text', 'sites-choice-bg', 4.5], ['sites-muted', 'sites-choice-bg', 4.5],
  ['sites-choice-border', 'surface', 3],
  ['text-secondary', 'blue-bg', 4.5], ['blue', 'blue-bg', 4.5],
  ['warning-text', 'surface', 4.5], ['designer-error-action', 'designer-error-bg', 4.5],
  ['text-secondary', 'designer-section-bg', 4.5], ['text-secondary', 'dashboard-soft', 4.5]
]
export function isSitesContrast(result: { foreground: string; background: string; id?: string }) {
  if (result.id?.includes(':automation-report:') || isBillingContrast(result)) return false
  return sitesContrastPairs.some(([foreground, background]) => foreground === result.foreground && background === result.background)
}

/** HU-165: claros heredados del diseñador autorizados aparte; todos los oscuros nuevos exigen AA. */
export const designerContrastPairs: [keyof typeof lightTokens, keyof typeof lightTokens, number][] = [
  ['designer-node-text', 'surface', 4.5], ['designer-node-text', 'designer-node-head', 4.5],
  ['designer-node-text', 'designer-new-head', 4.5], ['designer-node-text', 'designer-added-row', 4.5],
  ['designer-node-meta', 'designer-node-head', 4.5], ['designer-node-meta', 'designer-new-head', 4.5],
  ['primary-fg', 'designer-new', 4.5], ['designer-added-text', 'designer-added-bg', 4.5],
  ['designer-label', 'surface', 4.5], ['designer-label', 'bg', 4.5], ['designer-label', 'designer-label-bg', 4.5],
  ['designer-section-text', 'designer-section-bg', 4.5], ['designer-system-text', 'dashboard-soft', 4.5],
  ['designer-system-text', 'designer-system-tag', 4.5], ['designer-system-muted', 'dashboard-soft', 4.5],
  ['designer-type', 'surface', 4.5], ['designer-type', 'designer-added-row', 4.5],
  ['text-secondary', 'designer-markdown-code', 4.5], ['designer-markdown-heading', 'surface', 4.5],
  ['designer-error-text', 'designer-error-bg', 4.5], ['designer-error-action', 'surface', 4.5],
  ['designer-error-action', 'designer-error-hover', 4.5], ['designer-success-text', 'designer-success-bg', 4.5],
  ['designer-success-strong', 'designer-success-bg', 4.5], ['designer-warning-text', 'designer-warning-bg', 4.5],
  ['designer-warning-secondary', 'surface', 4.5], ['designer-warning-strong', 'designer-warning-bg', 4.5],
  ['designer-controls-icon', 'designer-controls-bg', 4.5], ['designer-controls-icon', 'designer-controls-hover', 4.5],
  ['text-secondary', 'bg', 4.5], ['text-secondary', 'surface', 4.5],
  ['designer-node-border', 'surface', 3], ['designer-new', 'surface', 3],
  ['designer-edge', 'bg', 3], ['designer-existing-edge', 'bg', 3], ['designer-new-arrow', 'bg', 3],
  ['designer-selected-edge', 'bg', 3], ['designer-system-muted', 'bg', 3], ['designer-system-icon', 'surface', 3],
  ['designer-handle', 'bg', 3], ['designer-edge-updating', 'bg', 3],
  ['designer-edge', 'designer-section-bg', 3], ['designer-existing-edge', 'designer-section-bg', 3],
  ['designer-new-arrow', 'designer-section-bg', 3], ['designer-selected-edge', 'designer-section-bg', 3],
  ['designer-handle', 'designer-section-bg', 3],
  ['designer-minimap-existing', 'designer-minimap-bg', 3], ['designer-minimap-new', 'designer-minimap-bg', 3],
  ['designer-minimap-system', 'designer-minimap-bg', 3],
  ['designer-minimap-existing', 'designer-minimap-section', 3], ['designer-minimap-new', 'designer-minimap-section', 3],
  ['designer-minimap-system', 'designer-minimap-section', 3]
]
export function isDesignerContrast(result: { foreground: string; background: string; id?: string }) {
  if (result.id?.includes(':automation-report:') || isBillingContrast(result)) return false
  return designerContrastPairs.some(([foreground, background]) => foreground === result.foreground && background === result.background)
    // Contador y leyenda usan pares originales; su auditoría permanece en la sección general.
    && (result.foreground.startsWith('designer-') || result.background.startsWith('designer-'))
}

/** Fondo efectivo compuesto en sRGB; conserva fracciones de canal y alfas reales del lienzo. */
export function compositeContrast(foreground: string, overlay: string, background: string, alpha: number, underlay?: [string, number]) {
  const channels = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16))
  const base = channels(background).map((value, index) => underlay ? channels(underlay[0])[index]! * underlay[1] + value * (1 - underlay[1]) : value)
  const mixed = channels(overlay).map((value, index) => value * alpha + base[index]! * (1 - alpha))
  const luminance = (rgb: number[]) => rgb.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0)
  const a = luminance(channels(foreground)), b = luminance(mixed)
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
}

/** HU-168: déficits claros heredados autorizados, todos los oscuros nuevos exigen AA. */
export const editorContrastPairs: [keyof typeof lightTokens, keyof typeof lightTokens, number][] = [
  ['text', 'sites-editor-code-bg', 4.5],
  ['sites-editor-syntax-meta', 'sites-editor-code-bg', 4.5],
  ['sites-editor-syntax-keyword', 'sites-editor-code-bg', 4.5],
  ['sites-editor-syntax-atom', 'sites-editor-code-bg', 4.5],
  ['sites-editor-syntax-literal', 'sites-editor-code-bg', 4.5],
  ['sites-editor-syntax-string', 'sites-editor-code-bg', 4.5],
  ['sites-editor-syntax-regexp', 'sites-editor-code-bg', 4.5],
  ['sites-editor-syntax-definition', 'sites-editor-code-bg', 4.5],
  ['sites-editor-syntax-local', 'sites-editor-code-bg', 4.5],
  ['sites-editor-syntax-type', 'sites-editor-code-bg', 4.5],
  ['sites-editor-syntax-class', 'sites-editor-code-bg', 4.5],
  ['sites-editor-syntax-special', 'sites-editor-code-bg', 4.5],
  ['sites-editor-syntax-property', 'sites-editor-code-bg', 4.5],
  ['sites-editor-syntax-comment', 'sites-editor-code-bg', 4.5],
  ['sites-editor-syntax-invalid', 'sites-editor-code-bg', 4.5],
  ['text', 'sites-editor-active', 4.5],
  ['sites-editor-syntax-meta', 'sites-editor-active', 4.5],
  ['sites-editor-syntax-keyword', 'sites-editor-active', 4.5],
  ['sites-editor-syntax-atom', 'sites-editor-active', 4.5],
  ['sites-editor-syntax-literal', 'sites-editor-active', 4.5],
  ['sites-editor-syntax-string', 'sites-editor-active', 4.5],
  ['sites-editor-syntax-regexp', 'sites-editor-active', 4.5],
  ['sites-editor-syntax-definition', 'sites-editor-active', 4.5],
  ['sites-editor-syntax-local', 'sites-editor-active', 4.5],
  ['sites-editor-syntax-type', 'sites-editor-active', 4.5],
  ['sites-editor-syntax-class', 'sites-editor-active', 4.5],
  ['sites-editor-syntax-special', 'sites-editor-active', 4.5],
  ['sites-editor-syntax-property', 'sites-editor-active', 4.5],
  ['sites-editor-syntax-comment', 'sites-editor-active', 4.5],
  ['sites-editor-syntax-invalid', 'sites-editor-active', 4.5],
  ['text', 'sites-editor-selection', 4.5],
  ['sites-editor-syntax-meta', 'sites-editor-selection', 4.5],
  ['sites-editor-syntax-keyword', 'sites-editor-selection', 4.5],
  ['sites-editor-syntax-atom', 'sites-editor-selection', 4.5],
  ['sites-editor-syntax-literal', 'sites-editor-selection', 4.5],
  ['sites-editor-syntax-string', 'sites-editor-selection', 4.5],
  ['sites-editor-syntax-regexp', 'sites-editor-selection', 4.5],
  ['sites-editor-syntax-definition', 'sites-editor-selection', 4.5],
  ['sites-editor-syntax-local', 'sites-editor-selection', 4.5],
  ['sites-editor-syntax-type', 'sites-editor-selection', 4.5],
  ['sites-editor-syntax-class', 'sites-editor-selection', 4.5],
  ['sites-editor-syntax-special', 'sites-editor-selection', 4.5],
  ['sites-editor-syntax-property', 'sites-editor-selection', 4.5],
  ['sites-editor-syntax-comment', 'sites-editor-selection', 4.5],
  ['sites-editor-syntax-invalid', 'sites-editor-selection', 4.5],
  ['text', 'sites-editor-search', 4.5],
  ['sites-editor-syntax-meta', 'sites-editor-search', 4.5],
  ['sites-editor-syntax-keyword', 'sites-editor-search', 4.5],
  ['sites-editor-syntax-atom', 'sites-editor-search', 4.5],
  ['sites-editor-syntax-literal', 'sites-editor-search', 4.5],
  ['sites-editor-syntax-string', 'sites-editor-search', 4.5],
  ['sites-editor-syntax-regexp', 'sites-editor-search', 4.5],
  ['sites-editor-syntax-definition', 'sites-editor-search', 4.5],
  ['sites-editor-syntax-local', 'sites-editor-search', 4.5],
  ['sites-editor-syntax-type', 'sites-editor-search', 4.5],
  ['sites-editor-syntax-class', 'sites-editor-search', 4.5],
  ['sites-editor-syntax-special', 'sites-editor-search', 4.5],
  ['sites-editor-syntax-property', 'sites-editor-search', 4.5],
  ['sites-editor-syntax-comment', 'sites-editor-search', 4.5],
  ['sites-editor-syntax-invalid', 'sites-editor-search', 4.5],
  ['sites-muted', 'sites-editor-gutter', 4.5],
  ['blue', 'sites-editor-gutter', 3],
  ['sites-muted', 'sites-editor-active', 4.5],
  ['blue', 'sites-editor-active', 3],
  ['blue', 'sites-editor-code-bg', 3],
  ['sites-editor-match-bracket', 'sites-editor-code-bg', 3],
  ['sites-editor-bad-bracket', 'sites-editor-code-bg', 3],
  ['sites-editor-syntax-invalid', 'sites-editor-code-bg', 3],
  ['sites-editor-match-bracket', 'sites-editor-active', 3],
  ['sites-editor-bad-bracket', 'sites-editor-active', 3],
  ['sites-editor-syntax-invalid', 'sites-editor-active', 3],
  ['blue', 'sites-editor-selection', 3],
  ['sites-editor-match-bracket', 'sites-editor-selection', 3],
  ['sites-editor-bad-bracket', 'sites-editor-selection', 3],
  ['sites-editor-syntax-invalid', 'sites-editor-selection', 3],
  ['sites-editor-search-border', 'sites-editor-search', 3],
  ['text', 'sites-editor-tooltip', 4.5],
  ['text-secondary', 'sites-editor-tooltip', 4.5],
  ['blue', 'sites-editor-tooltip', 4.5],
  ['control-border', 'sites-editor-tooltip', 3],
  ['text', 'sites-editor-search-panel', 4.5],
  ['text-secondary', 'sites-editor-search-panel', 4.5],
  ['blue', 'sites-editor-search-panel', 4.5],
  ['control-border', 'sites-editor-search-panel', 3],
  ['text', 'sites-editor-completion', 4.5],
  ['text-secondary', 'sites-editor-completion', 4.5],
  ['blue', 'sites-editor-completion', 4.5],
  ['control-border', 'sites-editor-completion', 3],
  ['text', 'sites-editor-completion-disabled', 4.5],
  ['text-secondary', 'sites-editor-completion-disabled', 4.5],
  ['blue', 'sites-editor-completion-disabled', 4.5],
  ['control-border', 'sites-editor-completion-disabled', 3],
  ['sites-editor-completion-text', 'sites-editor-completion', 4.5],
  ['sites-editor-completion-text', 'sites-editor-completion-disabled', 4.5],
  ['sites-editor-draft-text', 'surface', 4.5],
  ['sites-editor-dirty-text', 'surface', 4.5],
  ['sites-editor-icon', 'surface', 4.5],
  ['sites-editor-tab', 'surface', 4.5],
  ['sites-editor-link', 'surface', 4.5],
  ['sites-editor-empty-icon', 'surface', 4.5],
  ['sites-editor-draft-text', 'sites-editor-draft-bg', 4.5],
  ['text', 'sites-editor-form-bg', 4.5],
  ['text-secondary', 'sites-editor-form-bg', 4.5],
  ['sites-muted', 'sites-editor-form-bg', 4.5],
  ['text', 'sites-editor-field-bg', 4.5],
  ['text-secondary', 'sites-editor-field-bg', 4.5],
  ['sites-muted', 'sites-editor-field-bg', 4.5],
  ['text', 'sites-editor-form-hover', 4.5],
  ['text-secondary', 'sites-editor-form-hover', 4.5],
  ['sites-muted', 'sites-editor-form-hover', 4.5],
  ['text', 'sites-editor-warning-bg', 4.5],
  ['text-secondary', 'sites-editor-warning-bg', 4.5],
  ['sites-muted', 'sites-editor-warning-bg', 4.5],
  ['sites-warning-text', 'sites-editor-warning-bg', 4.5],
  ['sites-editor-hover-border', 'surface', 3],
  ['sites-editor-form-border', 'surface', 3],
  ['sites-editor-asset-focus', 'surface', 3],
  ['sites-editor-code-scrollbar', 'sites-editor-code-track', 3],
  ['sites-editor-code-scrollbar-hover', 'sites-editor-code-track', 3]
]
/** Solo combinaciones que el editor claro anterior realmente renderizaba.
 * Los overrides exclusivos del oscuro (texto secundario/azul en autocompletado,
 * bordes de panel, marca de gutter) se auditan en oscuro, sin atribuirles un
 * déficit claro heredado que no existe en la interfaz anterior.
 */
export const editorLightContrastPairs = editorContrastPairs.filter(([foreground, background]) => {
  if (background === 'sites-editor-completion' || background === 'sites-editor-completion-disabled') return foreground === 'sites-editor-completion-text'
  if (background === 'sites-editor-search-panel') return foreground === 'text'
  if (background === 'sites-editor-tooltip') return foreground === 'text' || foreground === 'control-border'
  if (background === 'sites-editor-gutter' || background === 'sites-editor-active') {
    if (foreground === 'blue' && background === 'sites-editor-gutter') return false
  }
  return true
})
export function isEditorContrast(result: { foreground: string; background: string; id?: string }) {
  if (result.id?.includes(':automation-report:') || isBillingContrast(result)) return false
  return result.foreground.startsWith('sites-editor-') || result.background.startsWith('sites-editor-')
}

export function themeContrasts() {
  const pairs: [keyof typeof lightTokens, keyof typeof lightTokens, number][] = []
  for (const background of ['bg', 'surface'] as const) {
    for (const foreground of ['text', 'text-secondary', 'text-muted'] as const) pairs.push([foreground, background, 4.5])
  }
  pairs.push(['primary-fg', 'orange', 4.5], ['primary-fg', 'orange-hover', 4.5], ['blue', 'surface', 4.5], ['blue-hover', 'surface', 4.5], ['accent-fg', 'blue', 4.5], ['error-fg', 'error-text', 4.5], ['border', 'surface', 3], ['control-border', 'surface', 3])
  pairs.push(['tooltip-fg', 'tooltip-bg', 4.5], ['tooltip-muted', 'tooltip-bg', 4.5], ['tooltip-link', 'tooltip-bg', 4.5], ['help-text', 'help-bg', 4.5], ['panel-muted', 'panel-soft', 4.5], ['message-text', 'info-bg', 4.5])
  for (const name of ['success', 'warning', 'error', 'info', 'neutral', 'purple', 'pink', 'gold', 'indigo'] as const) pairs.push([`${name}-text`, `${name}-bg`, 4.5])
  pairs.push(['text', 'kanban-column', 4.5], ['text', 'origin-bg', 4.5], ['mention-hover', 'surface', 4.5], ['activity-error', 'surface', 4.5], ['stage-purple', 'surface', 4.5], ['app-pending-text', 'surface', 4.5])
  pairs.push(['billing-warning-text', 'billing-warning-bg', 4.5], ['billing-error-text', 'billing-error-bg', 4.5], ['billing-info-text', 'billing-info-bg', 4.5])
  // Los iconos y acciones de las alertas usan superficie blanca en claro.
  pairs.push(['billing-warning-text', 'surface', 4.5], ['billing-error-text', 'surface', 4.5], ['billing-info-text', 'surface', 4.5])
  pairs.push(['recipient-text', 'blue-bg', 4.5], ['recipient-role', 'purple-bg', 4.5], ['module-code-text', 'module-code-bg', 4.5], ['chat-warning-text', 'chat-warning-bg', 4.5], ['text', 'help-bg', 4.5])
  // Texto secundario de citas/nombres y metadatos propios en oscuro.
  pairs.push(['text-secondary', 'help-bg', 4.5], ['primary-fg', 'success-text', 4.5])
  pairs.push(...labelContrastPairs)
  pairs.push(...sitesContrastPairs)
  pairs.push(...editorContrastPairs)
  pairs.push(...resizeContrastPairs.filter(([foreground, background]) => foreground.startsWith('resize-') || background.startsWith('resize-')))
  pairs.push(...designerContrastPairs.filter(([foreground, background]) => foreground.startsWith('designer-') || background.startsWith('designer-')))
  return (['light', 'dark'] as const).flatMap(theme => pairs.filter(([foreground, background]) => theme === 'dark' || !isEditorContrast({ foreground, background }) || editorLightContrastPairs.some(([f, b]) => f === foreground && b === background)).map(([foreground, background, minimum]) => {
    const tokens = theme === 'light' ? lightTokens : darkTokens
    return { id: `${theme}:${foreground}/${background}`, theme, foreground, background, minimum, ratio: theme === 'light' && (foreground === 'sites-editor-match-bracket' || foreground === 'sites-editor-bad-bracket') && ['sites-editor-code-bg', 'sites-editor-active', 'sites-editor-selection'].includes(background) ? compositeContrast(tokens[background], tokens[foreground], tokens[background], foreground === 'sites-editor-match-bracket' ? 82 / 255 : 68 / 255) : background === 'designer-section-bg' && foreground.startsWith('designer-') ? compositeContrast(tokens[foreground], tokens[background], tokens.bg, .8) : contrast(tokens[foreground], tokens[background]) }
  }).concat([false, true].map(section => {
    const tokens = theme === 'light' ? lightTokens : darkTokens
    return { id: `${theme}:designer-label/designer-label-bg@0.92/${section ? 'section@0.8' : 'bg'}`, theme, foreground: 'designer-label' as const, background: 'designer-label-bg' as const, minimum: 4.5,
      ratio: compositeContrast(tokens['designer-label'], tokens['designer-label-bg'], tokens.bg, .92, section ? [tokens['designer-section-bg'], .8] : undefined) }
  }))).concat((['light', 'dark'] as const).flatMap(theme => automationReportContrastPairs.map(([foreground, background, minimum]) => {
    const tokens = theme === 'light' ? lightTokens : darkTokens
    return { id: `${theme}:automation-report:${foreground}/${background}@${minimum}`, theme, foreground, background, minimum, ratio: contrast(tokens[foreground], tokens[background]) }
  }))).concat((['light', 'dark'] as const).flatMap(theme => billingContrastPairs.map(([foreground, background, minimum]) => {
    const tokens = theme === 'light' ? lightTokens : darkTokens
    return { id: `${theme}:billing:${foreground}/${background}@${minimum}`, theme, foreground, background, minimum, ratio: contrast(tokens[foreground], tokens[background]) }
  })))
}
