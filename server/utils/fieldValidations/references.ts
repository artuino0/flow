import { z } from 'zod'
import { FIELD_VALIDATIONS, applyFieldDefaults } from './registry'
import { and, eq, inArray } from 'drizzle-orm'
import { createError } from 'h3'
import type { db } from '~/server/db'
import { entities, entityFields, files, records, tenants } from '~/server/db/schema'
import { recordNotDeleted } from '~/server/utils/records'
import { MAX_FILE_SIZE_BYTES } from './filePolicy'

type Field = { name: string; dataType: string; validationRules: unknown }
interface ReferenceCache {
  files: Map<string, { entityId: string; mimeType: string; fileName: string; sizeBytes: number }>
  targets: Map<string, Record<string, unknown>>
}
/** Un lote por página para el impacto; evita consultar cada referencia individualmente. */
export async function preloadValidationReferences(tx: typeof db, tenantId: string, fields: Field[], rows: Array<Record<string, unknown>>): Promise<ReferenceCache> {
  const cache: ReferenceCache = { files: new Map(), targets: new Map() }
  const fileIds = new Set<string>()
  const destinations = new Map<string, Set<string>>()
  for (const field of fields) {
    const rules = (field.validationRules ?? {}) as Record<string, unknown>
    const referenceRules = FIELD_VALIDATIONS.filter(rule => rule.reference && rule.variants[field.dataType as 'file' | 'relation'] && rules[rule.id] !== undefined)
    if (!referenceRules.length) continue
    for (const row of rows) {
      const value = row[field.name]
      if (typeof value !== 'string' || !z.string().uuid().safeParse(value).success) continue
      if (field.dataType === 'file') fileIds.add(value)
      if (field.dataType === 'relation' && typeof rules.relationEntity === 'string') {
        if (!destinations.has(rules.relationEntity)) destinations.set(rules.relationEntity, new Set())
        destinations.get(rules.relationEntity)!.add(value)
      }
    }
  }
  if (fileIds.size) for (const file of await tx.select({ id: files.id, entityId: files.entityId, mimeType: files.mimeType, fileName: files.fileName, sizeBytes: files.sizeBytes }).from(files).where(and(eq(files.tenantId, tenantId), inArray(files.id, [...fileIds])))) cache.files.set(file.id, file)
  for (const [slug, ids] of destinations) for (const row of await tx.select({ id: records.id, customData: records.customData }).from(records).innerJoin(entities, eq(entities.id, records.entityId)).where(and(eq(records.tenantId, tenantId), eq(entities.tenantId, tenantId), eq(entities.slug, slug), inArray(records.id, [...ids]), recordNotDeleted))) cache.targets.set(`${slug}:${row.id}`, row.customData as Record<string, unknown>)
  return cache
}

/** Verifica referencias usando metadata del servidor, nunca tamaños o tipos declarados en el body. */
export async function referenceValidationFailures(tx: typeof db, tenantId: string, entityId: string | undefined, fields: Field[], data: Record<string, unknown>, cache?: ReferenceCache): Promise<string[]> {
  const failures: string[] = []
  for (const field of fields) {
    const value = data[field.name]
    if (value == null || value === '') continue
    const rules = (field.validationRules ?? {}) as Record<string, unknown>
    const referenceRules = FIELD_VALIDATIONS.filter(rule => rule.reference && rule.variants[field.dataType as 'file' | 'relation'] && rules[rule.id] !== undefined)
    if (field.dataType === 'file' && referenceRules.length) {
      const file = cache ? cache.files.get(String(value)) : (await tx.select().from(files).where(and(eq(files.id, String(value)), eq(files.tenantId, tenantId))).limit(1))[0]
      if (!file || (entityId && file.entityId !== entityId) || file.sizeBytes > MAX_FILE_SIZE_BYTES || referenceRules.some(rule => !rule.check(value, rules[rule.id], { file }, rules))) failures.push(field.name)
    }
    if (field.dataType === 'relation' && referenceRules.length && typeof rules.relationEntity === 'string') {
      const target = cache ? cache.targets.get(`${rules.relationEntity}:${String(value)}`) : (await tx.select({ customData: records.customData }).from(records).innerJoin(entities, eq(entities.id, records.entityId)).where(and(eq(records.id, String(value)), eq(records.tenantId, tenantId), eq(entities.tenantId, tenantId), eq(entities.slug, rules.relationEntity), recordNotDeleted)).limit(1))[0]?.customData as Record<string, unknown> | undefined
      if (referenceRules.some(rule => !rule.check(value, rules[rule.id], { target: target ?? null }, rules))) failures.push(field.name)
    }
  }
  return failures
}
export async function assertFieldReferences(tx: typeof db, tenantId: string, fields: Field[], data: Record<string, unknown>) {
  const failures = await referenceValidationFailures(tx, tenantId, undefined, fields, data)
  if (failures.length) throw createError({ statusCode: 422, statusMessage: `Archivo o relación no elegible en los campos: ${failures.join(', ')}` })
}
/** Referencias de configuración: misma entidad para fechas, entidad destino del tenant para filtros. */
export async function assertValidationReferences(tx: typeof db, tenantId: string, entityId: string, fieldName: string, dataType: string, rules: Record<string, unknown>): Promise<void> {
  for (const key of ['after', 'before']) {
    if (dataType !== 'date' || typeof rules[key] !== 'string') continue
    const [field] = await tx.select({ dataType: entityFields.dataType }).from(entityFields).where(and(eq(entityFields.entityId, entityId), eq(entityFields.name, rules[key] as string))).limit(1)
    if (rules[key] === fieldName || field?.dataType !== 'date') throw createError({ statusCode: 422, statusMessage: `${key}: debe indicar otro campo Fecha de la misma entidad` })
  }
  if (dataType === 'relation' && rules.eligibleFilter && typeof rules.relationEntity === 'string') {
    const filter = rules.eligibleFilter as { field: string }
    const [target] = await tx.select({ dataType: entityFields.dataType }).from(entityFields).innerJoin(entities, eq(entities.id, entityFields.entityId)).where(and(eq(entities.tenantId, tenantId), eq(entities.slug, rules.relationEntity), eq(entityFields.name, filter.field))).limit(1)
    if (!target || !['text', 'number', 'currency', 'boolean', 'select', 'date'].includes(target.dataType)) throw createError({ statusCode: 422, statusMessage: 'El filtro debe indicar un campo simple de la entidad destino de la organización' })
  }
}

/** Antes de cálculos: los operandos pueden depender de valores predeterminados. */
export async function defaultRecordValues(tx: typeof db, tenantId: string, fields: Field[], input: Record<string, unknown>, userId?: string) {
  const [organization] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  return applyFieldDefaults(fields, input, { timezone: organization?.timezone, userId })
}
