import type { Blueprint } from '~/server/utils/blueprint/schema'

const stable = (value: unknown): unknown => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]))
    : value

/** JSONB no conserva el orden de claves; el orden de módulos y campos sí importa. */
export function designerBlueprintsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right))
}

/** El plano persistido es la única fuente para la sesión y la copia editable. */
export function acceptDesignerSession<T extends { blueprint: Blueprint }>(session: T): { session: T; working: Blueprint } {
  return { session, working: JSON.parse(JSON.stringify(session.blueprint)) as Blueprint }
}
