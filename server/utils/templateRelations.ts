import { and, eq, isNull } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { entities, entityFields, records } from '~/server/db/schema'

// Resolve only requested paths, inside the workflow tenant. No arbitrary object traversal.
export async function templateRelationData(tenantId: string, entityId: string, data: Record<string, unknown>, templates: string[]) {
  const paths = [...new Set(templates.flatMap(text => [...text.matchAll(/\{\{\s*([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+){1,3})\s*\}\}/g)].map(match => match[1]!)))]
  if (!paths.length) return data
  return withTenant(tenantId, async tx => {
    const result = { ...data }
    for (const path of paths) {
      let currentEntity = entityId
      let current = data
      const parts = path.split('.')
      for (let index = 0; index < parts.length; index++) {
        const name = parts[index]!
        const [field] = await tx.select().from(entityFields).where(and(eq(entityFields.entityId, currentEntity), eq(entityFields.name, name))).limit(1)
        if (!field) throw new Error(`La variable ${path} hace referencia a un campo que ya no existe.`)
        if (index === parts.length - 1) {
          if (current[name] == null) throw new Error(`La variable ${path} no tiene valor.`)
          result[path] = current[name]; break
        }
        const slug = (field.validationRules as Record<string, unknown>)?.relationEntity
        if (field.dataType !== 'relation' || typeof slug !== 'string') throw new Error(`La variable ${path} no es una relación válida.`)
        const [entity] = await tx.select({ id: entities.id }).from(entities).where(and(eq(entities.tenantId, tenantId), eq(entities.slug, slug))).limit(1)
        const id = current[name]
        if (!entity || typeof id !== 'string') throw new Error(`La relación ${path} está vacía.`)
        const [record] = await tx.select({ customData: records.customData }).from(records).where(and(eq(records.tenantId, tenantId), eq(records.entityId, entity.id), eq(records.id, id), isNull(records.deletedAt))).limit(1)
        if (!record) throw new Error(`El registro relacionado de ${path} no está disponible.`)
        current = record.customData as Record<string, unknown>; currentEntity = entity.id
      }
    }
    return result
  })
}
