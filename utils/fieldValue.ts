/** Devuelve el valor efectivo que debe mostrarse y validarse en el formulario. */
export function resolveFieldValue(name: string, values: Record<string, unknown>, fixedValues?: Record<string, unknown>): unknown {
  return fixedValues && Object.hasOwn(fixedValues, name) ? fixedValues[name] : values[name]
}
