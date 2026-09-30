import { blueprintSchema, type Blueprint } from '~/server/utils/blueprint/schema'

export const STALE_DESIGN_MESSAGE = 'Este plano quedó desactualizado porque algunos módulos ya no existen. Usa «Corregir con IA» para actualizar una base sin propuestas; si ya la editaste, genera la propuesta de nuevo en una nueva sesión.'

export const DESIGNER_REPAIR_PREFIX = 'Corrige únicamente los errores de validación indicados en el plano. Conserva todo lo demás sin cambios y usa un parche pequeño.'

/** Solo una base sin propuestas ni ediciones se puede sustituir sin perder trabajo. */
export function resyncDesignerBase(session: { blueprint: unknown; version: number; messages: unknown[] }, current: Blueprint) {
  const parsed = blueprintSchema.safeParse(session.blueprint)
  if (!parsed.success) return { blueprint: session.blueprint, resynced: false, stale: false }
  const slugs = new Set(current.modules.map(module => module.slug))
  const stale = parsed.data.modules.some(module => module.action === 'extend' && !slugs.has(module.slug))
  const untouchedBase = session.version === 1 && session.messages.length === 0 && parsed.data.modules.every(module => module.action === 'extend' && module.snapshot)
  return { blueprint: stale && untouchedBase ? structuredClone(current) : session.blueprint, resynced: stale && untouchedBase, stale }
}
