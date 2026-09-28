import { and, count, desc, eq, isNull, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db, withTenant } from '~/server/db'
import { blueprintApplications, entities, entityFields, people, recordRelations, records, relationDefinitions, roleEntityPermissions, roles, users } from '~/server/db/schema'
import { deleteEntityInTx, updateEntityInTx } from '~/server/utils/moduleEntities'
import { deleteEntityFieldInTx } from '~/server/utils/moduleEntityFields'
import { deleteRelationDefinitionInTx } from '~/server/utils/relationDefinitions'
import { invalidateTenantAccess } from '~/server/utils/shortCache'
import { invalidateEntitySchemaCache } from '~/server/utils/dynamicSchema'
import type { BlueprintApplyResult } from './apply'
import type { Blueprint } from './schema'

type Tx = typeof db
type Application = typeof blueprintApplications.$inferSelect
type Entity = typeof entities.$inferSelect
type Association = typeof relationDefinitions.$inferSelect

function changes(row: Application, tenantEntities: Entity[], associations: Association[]) {
  const result = row.result as BlueprintApplyResult
  const blueprint = row.appliedBlueprint as Blueprint
  const bySlug = new Map(tenantEntities.map(entity => [entity.slug, entity]))
  const created = new Set((result.modules ?? []).map(module => module.id))
  const touched = new Set(result.touchedModuleIds ?? [])
  for (const module of result.modules ?? []) touched.add(module.id)
  for (const field of result.fields ?? []) touched.add(field.entityId)
  for (const slug of [...(result.layouts ?? []), ...(result.workflows ?? []), ...(result.calendarConfigs ?? [])]) {
    const entity = bySlug.get(slug)
    if (entity) touched.add(entity.id)
  }
  const createdAssociations = result.createdAssociations ?? associations.filter(association => (result.associations ?? []).includes(association.name))
  for (const association of createdAssociations) {
    touched.add(association.sourceEntityId)
    touched.add(association.targetEntityId)
  }
  // En auditorías antiguas ya borradas, el vínculo puede no existir; las
  // referencias del plano aún permiten detectar la dependencia entre diseños.
  for (const association of blueprint.associations ?? []) if ((result.associations ?? []).includes(association.name)) {
    const source = blueprint.modules.find(module => module.ref === association.sourceRef)
    const target = blueprint.modules.find(module => module.ref === association.targetRef)
    if (source && bySlug.get(source.slug)) touched.add(bySlug.get(source.slug)!.id)
    if (target && bySlug.get(target.slug)) touched.add(bySlug.get(target.slug)!.id)
  }
  const prior = new Map((result.before ?? []).map(item => [item.entityId, item]))
  const warnings: string[] = []
  for (const slug of result.layouts ?? []) {
    const entity = bySlug.get(slug)
    if (entity && !created.has(entity.id) && !Object.hasOwn(prior.get(entity.id) ?? {}, 'detailLayout')) warnings.push(`No se puede restaurar el diseño de ficha de ${entity.name}; se conservará como está`)
  }
  for (const slug of result.workflows ?? []) {
    const entity = bySlug.get(slug)
    if (entity && !created.has(entity.id) && !Object.hasOwn(prior.get(entity.id) ?? {}, 'workflowConfig')) warnings.push(`No se pueden restaurar los estados de ${entity.name}; se conservarán como están`)
  }
  for (const slug of result.calendarConfigs ?? []) {
    const entity = bySlug.get(slug)
    if (entity && !created.has(entity.id) && !Object.hasOwn(prior.get(entity.id) ?? {}, 'calendarConfig')) warnings.push(`No se puede restaurar el calendario de ${entity.name}; se conservará como está`)
  }
  return { result, created, touched, prior, warnings, createdAssociations }
}

async function assess(tx: Tx, tenantId: string, row: Application, laterApplications: Application[], tenantEntities: Entity[], associations: Association[]) {
  const change = changes(row, tenantEntities, associations)
  const names = new Map(tenantEntities.map(entity => [entity.id, entity.name]))
  const blockers: string[] = []
  if (row.undoneAt) blockers.push('Este diseño ya fue deshecho')
  for (const later of laterApplications.filter(item => !item.undoneAt)) {
    const laterTouched = changes(later, tenantEntities, associations).touched
    if ([...change.touched].some(id => laterTouched.has(id))) blockers.push(`Deshaz primero el diseño posterior «${(later.appliedBlueprint as Blueprint).summary}»`)
  }
  for (const module of change.result.modules ?? []) {
    const [{ value }] = await tx.select({ value: count() }).from(records).where(and(eq(records.tenantId, tenantId), eq(records.entityId, module.id), isNull(records.deletedAt)))
    if (value) blockers.push(`${names.get(module.id) ?? module.slug}: ${value} registros`)
  }
  for (const field of (change.result.fields ?? []).filter(item => !change.created.has(item.entityId))) {
    const [{ value }] = await tx.select({ value: count() }).from(records).where(and(eq(records.tenantId, tenantId), eq(records.entityId, field.entityId), isNull(records.deletedAt), sql`${records.customData} ->> ${field.name} is not null`, sql`${records.customData} ->> ${field.name} <> ''`))
    if (value) blockers.push(`${names.get(field.entityId) ?? field.entityId}.${field.name}: ${value} valores`)
  }
  for (const association of change.createdAssociations) {
    const [{ value }] = await tx.select({ value: count() }).from(recordRelations).where(and(eq(recordRelations.tenantId, tenantId), eq(recordRelations.relationDefinitionId, association.id)))
    if (value) blockers.push(`${association.name}: ${value} vínculos`)
  }
  for (const roleId of change.result.createdRoles ?? []) {
    const [{ value }] = await tx.select({ value: count() }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.roleId, roleId)))
    if (value) blockers.push(`El rol creado tiene ${value} usuarios asignados`)
  }
  return { ...change, blockers }
}

export async function listBlueprintApplications(tenantId: string) {
  return withTenant(tenantId, async tx => {
    const [all, tenantEntities, associations, tenantUsers] = await Promise.all([
      tx.select().from(blueprintApplications).where(eq(blueprintApplications.tenantId, tenantId)).orderBy(desc(blueprintApplications.createdAt)),
      tx.select().from(entities).where(eq(entities.tenantId, tenantId)),
      tx.select().from(relationDefinitions).where(eq(relationDefinitions.tenantId, tenantId)),
      tx.select({ id: users.id, name: people.fullName }).from(users).innerJoin(people, eq(users.personId, people.id)).where(eq(users.tenantId, tenantId))
    ])
    const userNames = new Map(tenantUsers.map(user => [user.id, user.name]))
    return Promise.all(all.map(async (row, index) => {
      const state = await assess(tx, tenantId, row, all.slice(0, index), tenantEntities, associations)
      return { id: row.id, createdAt: row.createdAt, userId: row.userId, userName: row.userId ? userNames.get(row.userId) ?? null : null, summary: (row.appliedBlueprint as Blueprint).summary, modules: state.result.modules?.length ?? 0, fields: state.result.fields?.length ?? 0, associations: state.result.associations?.length ?? 0, undoneAt: row.undoneAt, canUndo: state.blockers.length === 0, reason: state.blockers.join('; ') || null, warnings: state.warnings }
    }))
  })
}

export async function undoBlueprintApplication(tenantId: string, applicationId: string, userId: string | null = null, confirmPartial = false) {
  const invalidated = new Set<string>()
  const outcome = await withTenant(tenantId, async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${tenantId}, 112))`)
    const [row] = await tx.select().from(blueprintApplications).where(and(eq(blueprintApplications.id, applicationId), eq(blueprintApplications.tenantId, tenantId))).for('update').limit(1)
    if (!row) throw createError({ statusCode: 404, statusMessage: 'Aplicación no encontrada' })
    const all = await tx.select().from(blueprintApplications).where(eq(blueprintApplications.tenantId, tenantId)).orderBy(desc(blueprintApplications.createdAt))
    const tenantEntities = await tx.select().from(entities).where(eq(entities.tenantId, tenantId))
    const associations = await tx.select().from(relationDefinitions).where(eq(relationDefinitions.tenantId, tenantId))
    const state = await assess(tx, tenantId, row, all.slice(0, all.findIndex(item => item.id === row.id)), tenantEntities, associations)
    if (state.blockers.length) throw createError({ statusCode: 409, statusMessage: state.blockers.join('; '), data: { blockers: state.blockers } })
    if (state.warnings.length && !confirmPartial) throw createError({ statusCode: 409, statusMessage: 'Confirma la reversión parcial: ' + state.warnings.join('; '), data: { warnings: state.warnings, requiresConfirmation: true } })
    for (const item of [...(state.result.previousRolePermissions ?? [])].reverse()) {
      if (item.previous) await tx.update(roleEntityPermissions).set({ visibility: item.previous.visibility, canRead: item.previous.canRead, canCreate: item.previous.canCreate, canUpdate: item.previous.canUpdate, canDelete: item.previous.canDelete, showInMenu: item.previous.showInMenu }).where(and(eq(roleEntityPermissions.roleId, item.roleId), eq(roleEntityPermissions.entityId, item.entityId)))
      else await tx.delete(roleEntityPermissions).where(and(eq(roleEntityPermissions.roleId, item.roleId), eq(roleEntityPermissions.entityId, item.entityId)))
    }
    for (const roleId of [...(state.result.createdRoles ?? [])].reverse()) await tx.delete(roles).where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)))
    for (const before of state.prior.values()) {
      const input: { detailLayout?: unknown; workflowConfig?: unknown; calendarConfig?: unknown } = {}
      if (Object.hasOwn(before, 'detailLayout')) input.detailLayout = before.detailLayout
      if (Object.hasOwn(before, 'workflowConfig')) input.workflowConfig = before.workflowConfig
      if (Object.hasOwn(before, 'calendarConfig')) input.calendarConfig = before.calendarConfig
      if (Object.keys(input).length && !await updateEntityInTx(tx, tenantId, before.entityId, input)) throw createError({ statusCode: 409, statusMessage: `No se pudo restaurar el módulo ${before.slug}` })
    }
    for (const association of [...state.createdAssociations].reverse()) {
      const deleted = await deleteRelationDefinitionInTx(tx, tenantId, association.id)
      if (deleted.status !== 'deleted') throw createError({ statusCode: 409, statusMessage: `No se pudo quitar la asociación ${association.name}` })
    }
    for (const field of [...(state.result.fields ?? [])].reverse().filter(item => !state.created.has(item.entityId))) {
      const [stored] = await tx.select({ id: entityFields.id }).from(entityFields).where(and(eq(entityFields.entityId, field.entityId), eq(entityFields.name, field.name))).limit(1)
      if (!stored || await deleteEntityFieldInTx(tx, tenantId, stored.id) !== 'deleted') throw createError({ statusCode: 409, statusMessage: `No se pudo quitar el campo ${field.name}` })
      invalidated.add(field.entityId)
    }
    for (const module of [...(state.result.modules ?? [])].reverse()) {
      if ((await deleteEntityInTx(tx, tenantId, module.id)).status !== 'deleted') throw createError({ statusCode: 409, statusMessage: `No se pudo enviar ${module.slug} a la papelera` })
      invalidated.add(module.id)
    }
    await tx.update(blueprintApplications).set({ undoneAt: new Date(), undoneBy: userId }).where(eq(blueprintApplications.id, row.id))
    return { id: row.id, warnings: state.warnings }
  })
  invalidateTenantAccess(tenantId)
  for (const id of invalidated) invalidateEntitySchemaCache(tenantId, id)
  return outcome
}
