import { and, count, eq, isNull, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { withTenant } from '~/server/db'
import { entities, entityFields, entityFieldHistory, records } from '~/server/db/schema'
import { agendaClientTarget } from '~/server/utils/agendaTemplate'
import { createEntityFieldInTx } from '~/server/utils/moduleEntityFields'
import { invalidateEntitySchemaCache } from '~/server/utils/dynamicSchema'
import { invalidateTenantAccess } from '~/server/utils/shortCache'
import { withSystemRecordAccess } from '~/server/utils/recordActorContext'

export async function agendaInstallOptions(tenantId: string) {
  return withTenant(tenantId, async tx => {
    const modules = await tx.select({ id: entities.id, slug: entities.slug, name: entities.name, templateKey: entities.templateKey })
      .from(entities).where(and(eq(entities.tenantId, tenantId), eq(entities.isActive, true), isNull(entities.deletedAt))).orderBy(entities.name)
    const base = modules.find(module => module.templateKey === 'agenda' && module.slug === 'agenda-citas') ?? null
    const candidates = await tx.select({ entityId: entityFields.entityId }).from(entityFields)
      .innerJoin(entities, eq(entityFields.entityId, entities.id)).where(and(eq(entities.tenantId, tenantId), eq(entityFields.dataType, 'text')))
    const textIds = new Set(candidates.map(field => field.entityId))
    const [client] = base ? await tx.select({ rules: entityFields.validationRules }).from(entityFields).where(and(eq(entityFields.entityId, base.id), eq(entityFields.name, 'cliente'))).limit(1) : []
    return { base, modules: modules.filter(module => module.id !== base?.id && textIds.has(module.id)), clientSlug: (client?.rules as { relationEntity?: string } | undefined)?.relationEntity ?? null }
  })
}

export async function changeAgendaClient(tenantId: string, entityId: string, changedBy: string, confirmed: boolean) {
  const result = await withSystemRecordAccess(() => withTenant(tenantId, async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${tenantId}, 174))`)
    const target = await agendaClientTarget(tx, tenantId, entityId)
    const [base] = await tx.select().from(entities).where(and(eq(entities.tenantId, tenantId), eq(entities.slug, 'agenda-citas'), eq(entities.templateKey, 'agenda'), isNull(entities.deletedAt))).limit(1)
    if (!base) throw createError({ statusCode: 404, statusMessage: 'Citas base todavía no está instalado.' })
    const [field] = await tx.select().from(entityFields).where(and(eq(entityFields.entityId, base.id), eq(entityFields.name, 'cliente'))).limit(1)
    if (!field) throw createError({ statusCode: 422, statusMessage: 'No se encontró el campo Cliente de Citas.' })
    const rules = field.validationRules as { relationEntity: string }
    if (rules.relationEntity === target.slug) return { entityId: base.id, affectedRecords: 0, archiveField: null }
    // Inhibe escrituras concurrentes mientras se archiva el vínculo y cambia la metadata.
    await tx.execute(sql`lock table records in share row exclusive mode`)
    const hasClient = and(eq(records.tenantId, tenantId), eq(records.entityId, base.id), sql`${records.customData}->>'cliente' is not null and ${records.customData}->>'cliente' <> ''`)
    const [{ affectedRecords }] = await tx.select({ affectedRecords: count() }).from(records).where(hasClient)
    if (affectedRecords && !confirmed) throw createError({ statusCode: 422, statusMessage: `${affectedRecords} citas conservarán el cliente anterior en un campo histórico y quedarán pendientes de seleccionar el nuevo Cliente. Confirma el cambio para continuar.` })
    let archiveField: string | null = null
    if (affectedRecords) {
      const fields = await tx.select({ name: entityFields.name }).from(entityFields).where(eq(entityFields.entityId, base.id))
      let index = 1
      while (fields.some(item => item.name === `cliente_anterior_${index}`)) index++
      archiveField = `cliente_anterior_${index}`
      await createEntityFieldInTx(tx, tenantId, base.id, { name: archiveField, label: `Cliente anterior (${rules.relationEntity})`, dataType: 'relation', isRequired: false, validationRules: { relationEntity: rules.relationEntity } })
      await tx.update(records).set({ customData: sql`(${records.customData} - 'cliente') || jsonb_build_object(${archiveField}::text, ${records.customData}->'cliente')`, isDirty: true, updatedAt: new Date() }).where(hasClient)
    }
    await tx.insert(entityFieldHistory).values({ entityFieldId: field.id, dataType: field.dataType, validationRules: field.validationRules, isRequired: field.isRequired, changedBy })
    await tx.update(entityFields).set({ validationRules: { ...rules, relationEntity: target.slug }, updatedAt: new Date() }).where(eq(entityFields.id, field.id))
    return { entityId: base.id, affectedRecords, archiveField }
  }))
  invalidateEntitySchemaCache(tenantId, result.entityId)
  invalidateTenantAccess(tenantId)
  return result
}
