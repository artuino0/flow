import { MODULE_ICON_KEYS, MODULE_ICON_KEY_SET } from '~/server/utils/moduleIcons'
import type { Blueprint } from '~/server/utils/blueprint/schema'

type Entry = Record<string, unknown>
const record = (value: unknown): value is Entry => value !== null && typeof value === 'object' && !Array.isArray(value)
const folded = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
const byFolded = new Map<string, string | null>()
for (const key of MODULE_ICON_KEYS) {
  const alias = folded(key)
  byFolded.set(alias, byFolded.has(alias) ? null : key)
}

/** Corrige solo iconos emitidos por la IA; el PUT manual conserva la validación estricta. */
export function normalizeDesignerIcons(input: unknown, current: Pick<Blueprint, 'modules'>): { blueprint: unknown; warnings: string[]; silentAdjustments?: number } {
  if (!record(input) || !Array.isArray(input.modules)) return { blueprint: input, warnings: [] }
  const warnings: string[] = []
  let silentAdjustments = 0
  const modules = input.modules.map((module: unknown, index: number) => {
    if (!record(module)) return module
    const existing = module.action === 'extend' ? current.modules.find(item => item.slug === module.slug) : undefined
    if (existing) {
      if (module.icon !== existing.icon) warnings.push(`Conservé el icono existente de ${existing.name}.`)
      return { ...module, icon: existing.icon }
    }
    if (module.action !== 'create') return module
    if (typeof module.icon === 'string' && MODULE_ICON_KEY_SET.has(module.icon)) return module
    const resolved = typeof module.icon === 'string' ? byFolded.get(folded(module.icon)) : undefined
    if (resolved) { silentAdjustments++; return { ...module, icon: resolved } }
    const name = typeof module.name === 'string' && module.name.trim() ? module.name : `módulo ${index + 1}`
    warnings.push(`Usé un icono genérico para ${name}; puedes cambiarlo desde el inspector.`)
    return { ...module, icon: 'Box' }
  })
  return { blueprint: { ...input, modules }, warnings, ...(silentAdjustments ? { silentAdjustments } : {}) }
}
