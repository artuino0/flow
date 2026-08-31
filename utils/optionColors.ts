// HU-ERD-71/73: paleta de color compartida para las opciones de un campo
// Select/Multiselect - los mismos 7 tokens de marca que ya usaban los badges
// de tipo de campo en ModuleFieldsCard.vue. Extraida del OPTION_COLORS local
// de FieldFormModal.vue (HU-ERD-71) para que el editor de opciones, el
// renderizado real del campo (DynamicForm.vue) y el panel de Filtros del
// listado (ambos HU-ERD-73) lean la MISMA fuente de verdad - mismo criterio
// que utils/slugify.ts (HU-ERD-71), sin duplicar el mapeo color -> clases.
export interface OptionColorToken {
  value: string
  label: string
  dot: string
  bg: string
  text: string
}

// "blue" usa bg-brand-blue como punto de color (mismo que FieldFormModal.vue
// ya usaba) pero bg-brand-info-bg/text-brand-info-text como badge completo -
// son el mismo azul (#0091AE) bajo dos nombres de token distintos en
// tailwind.config.ts, no dos colores distintos.
export const OPTION_COLORS: OptionColorToken[] = [
  { value: 'neutral', label: 'Gris', dot: 'bg-brand-neutral-text', bg: 'bg-brand-neutral-bg', text: 'text-brand-neutral-text' },
  { value: 'blue', label: 'Azul', dot: 'bg-brand-blue', bg: 'bg-brand-info-bg', text: 'text-brand-info-text' },
  { value: 'success', label: 'Verde', dot: 'bg-brand-success-text', bg: 'bg-brand-success-bg', text: 'text-brand-success-text' },
  { value: 'warning', label: 'Amarillo', dot: 'bg-brand-warning-text', bg: 'bg-brand-warning-bg', text: 'text-brand-warning-text' },
  { value: 'error', label: 'Rojo', dot: 'bg-brand-error-text', bg: 'bg-brand-error-bg', text: 'text-brand-error-text' },
  { value: 'purple', label: 'Morado', dot: 'bg-brand-purple-text', bg: 'bg-brand-purple-bg', text: 'text-brand-purple-text' },
  { value: 'pink', label: 'Rosa', dot: 'bg-brand-pink-text', bg: 'bg-brand-pink-bg', text: 'text-brand-pink-text' }
]

export function colorDotClass(color: string | undefined | null): string {
  return OPTION_COLORS.find((c) => c.value === color)?.dot ?? 'bg-brand-neutral-text'
}

export function colorBadgeClasses(color: string | undefined | null): { bg: string; text: string } {
  const found = OPTION_COLORS.find((c) => c.value === color)
  return found ? { bg: found.bg, text: found.text } : { bg: 'bg-brand-neutral-bg', text: 'text-brand-neutral-text' }
}

export interface SelectOption {
  value: string
  label: string
  color?: string
}

/** Devuelve la opción configurada (validationRules.options) para un value guardado, o undefined si no existe (opción borrada después). */
export function findOption(options: unknown, value: unknown): SelectOption | undefined {
  if (!Array.isArray(options)) return undefined
  return (options as SelectOption[]).find((o) => o.value === value)
}
