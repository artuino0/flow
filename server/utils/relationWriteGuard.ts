import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/db'
import { entities } from '~/server/db/schema'

type Field = { name: string; dataType: string; validationRules: unknown }
type RelationRef = { targetSlug: string; fieldName: string; value: string }

function refs(fields: Field[], data: Record<string, unknown>): RelationRef[] {
  const found: RelationRef[] = []
  for (const field of fields) {
    const rules = (field.validationRules ?? {}) as Record<string, unknown>
    if (field.dataType === 'relation' && typeof rules.relationEntity === 'string') {
      const value = data[field.name]
      if (typeof value === 'string' && value) found.push({ targetSlug: rules.relationEntity, fieldName: field.name, value })
    }
    if (field.dataType !== 'tabla' || !Array.isArray(data[field.name]) || !Array.isArray(rules.columns)) continue
    for (const row of data[field.name] as unknown[]) {
      if (!row || typeof row !== 'object') continue
      for (const column of rules.columns as Array<{ name?: string; type?: string; relationEntity?: string }>) {
        if (column.type !== 'relation' || !column.relationEntity || !column.name) continue
        const value = (row as Record<string, unknown>)[column.name]
        if (typeof value === 'string' && value) found.push({ targetSlug: column.relationEntity, fieldName: `${field.name}.${column.name}`, value })
      }
    }
  }
  return found
}

/** Conserva las referencias históricas sin permitir asignaciones nuevas a módulos apagados. */
export async function assertWritableRelations(
  tx: typeof db,
  tenantId: string,
  fields: Field[],
  nextData: Record<string, unknown>,
  previousData: Record<string, unknown> = {}
): Promise<void> {
  const previous = new Map<string, number>()
  for (const ref of refs(fields, previousData)) {
    const key = `${ref.targetSlug}\0${ref.fieldName}\0${ref.value}`
    previous.set(key, (previous.get(key) ?? 0) + 1)
  }
  const targetStatus = new Map<string, boolean>()
  for (const ref of refs(fields, nextData)) {
    const key = `${ref.targetSlug}\0${ref.fieldName}\0${ref.value}`
    const existing = previous.get(key) ?? 0
    if (existing > 0) {
      previous.set(key, existing - 1)
      continue
    }
    let enabled = targetStatus.get(ref.targetSlug)
    if (enabled === undefined) {
      const [target] = await tx.select({ isActive: entities.isActive, deletedAt: entities.deletedAt })
        .from(entities).where(and(eq(entities.tenantId, tenantId), eq(entities.slug, ref.targetSlug))).limit(1)
      enabled = Boolean(target?.isActive && !target.deletedAt)
      targetStatus.set(ref.targetSlug, enabled)
    }
    if (!enabled) {
      throw createError({ statusCode: 422, statusMessage: `No se puede crear una referencia en "${ref.fieldName}": el módulo "${ref.targetSlug}" está deshabilitado` })
    }
  }
}
