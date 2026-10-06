import { defaultRecordValues } from '~/server/utils/fieldValidations/references'
import { and, eq, sql } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import {
  entityFields,
  recordActivities,
  records,
  siteFormSubmissions,
  siteFormSubmissionTargets
} from '~/server/db/schema'
import { getEntityZodSchema } from '~/server/utils/dynamicSchema'
import { generateIncrementalValue, MissingIncrementalPrefixError } from '~/server/utils/incrementalField'
import { assertWritableRelations } from '~/server/utils/relationWriteGuard'
import { fireTriggersForRecord } from '~/server/utils/triggers'
import { applyCalculatedFields, recalculateCalculatedDependents, stripCalculatedValues } from '~/server/utils/calculatedFields'
import { assertPlanCapacity } from '~/server/utils/billing'
import { accountLifecycle } from '~/server/utils/accountLifecycle'
import { accountBlocked } from '~/utils/accountLifecycle'

type PublicValue = string | number | boolean | null | string[]
export type SiteFormPayload = Record<string, PublicValue>

interface FormManifestField {
  name: string
  required?: boolean
}

interface FormManifest {
  id: string
  name?: string
  fields?: FormManifestField[]
}

interface PublicFormContext {
  tenant_id: string
  site_id: string
  page_id: string
  connection_id: string
  entity_id: string
  entity_slug: string
  field_mapping: Record<string, string> | null
  default_values: Record<string, PublicValue> | null
  value_mappings: Record<string, Record<string, string>> | null
  form_manifest: FormManifest
}

interface TargetField {
  id: string
  name: string
  dataType: string
  validationRules: unknown
  isRequired: boolean
}

export interface SiteFormOrigin {
  domain: string
  path: string
  referrer: string | null
  userAgent: string | null
  utm: Record<string, string>
  capturedAt: string
}

const MAPPABLE_TYPES = new Set(['text', 'number', 'currency', 'boolean', 'date', 'select', 'multiselect'])

function firstValue(value: PublicValue): string | number | boolean | null {
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function convertValue(value: PublicValue, dataType: string): unknown {
  if (dataType === 'multiselect') {
    if (Array.isArray(value)) return value.filter(item => item !== '')
    return value === null || value === '' ? [] : [String(value)]
  }
  const raw = firstValue(value)
  if (raw === null || raw === '') return null
  if (dataType === 'boolean') return raw === true || raw === 1 || ['true', '1', 'on', 'yes', 'si', 'sí'].includes(String(raw).toLowerCase())
  if (dataType === 'number') {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : raw
  }
  return String(raw)
}

function translateValue(value: PublicValue, translations: Record<string, string>) {
  if (Array.isArray(value)) return value.map(item => translations[item] ?? item)
  if (value === null) return value
  return translations[String(value)] ?? value
}

export function mapSiteFormPayload(
  payload: SiteFormPayload,
  configuredMapping: Record<string, string>,
  fields: TargetField[],
  configuredDefaults: Record<string, PublicValue> = {},
  configuredValueMappings: Record<string, Record<string, string>> = {}
) {
  const byName = new Map(fields.map(field => [field.name, field]))
  const mapping = Object.keys(configuredMapping).length
    ? configuredMapping
    : Object.fromEntries(Object.keys(payload).filter(name => byName.has(name)).map(name => [name, name]))
  const customData: Record<string, unknown> = {}
  const appliedMapping: Record<string, string> = {}
  const appliedDefaults: Record<string, PublicValue> = {}
  for (const [sourceName, targetName] of Object.entries(mapping)) {
    const field = byName.get(targetName)
    if (!field || !MAPPABLE_TYPES.has(field.dataType) || !(sourceName in payload)) continue
    const translated = translateValue(payload[sourceName], configuredValueMappings[sourceName] ?? {})
    customData[targetName] = convertValue(translated, field.dataType)
    appliedMapping[sourceName] = targetName
  }
  for (const [targetName, value] of Object.entries(configuredDefaults)) {
    const field = byName.get(targetName)
    if (!field || !MAPPABLE_TYPES.has(field.dataType)) continue
    customData[targetName] = convertValue(value, field.dataType)
    appliedDefaults[targetName] = value
  }
  return { customData, appliedMapping, appliedDefaults }
}

async function resolveContext(siteId: string, pageId: string, formKey: string) {
  const rows = await db.execute(sql`
    select * from resolve_published_site_form(${siteId}::uuid, ${pageId}::uuid, ${formKey})
  `) as unknown as PublicFormContext[]
  return rows[0] ?? null
}

function assertRequiredFormFields(manifest: FormManifest, payload: SiteFormPayload) {
  const missing = (manifest.fields ?? []).filter(field => {
    if (!field.required) return false
    const value = payload[field.name]
    return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
  })
  if (missing.length) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Completa los campos requeridos.',
      data: { fields: missing.map(field => field.name) }
    })
  }
}

export async function submitSiteForm(input: {
  siteId: string
  pageId: string
  formKey: string
  payload: SiteFormPayload
  origin: SiteFormOrigin
}) {
  const context = await resolveContext(input.siteId, input.pageId, input.formKey)
  if (context && accountBlocked(await accountLifecycle(context.tenant_id))) throw createError({ statusCode: 404, statusMessage: 'Formulario no disponible.' })
  if (!context) throw createError({ statusCode: 404, statusMessage: 'El formulario no está publicado o no tiene un destino activo.' })
  await assertPlanCapacity(context.tenant_id, 'formSubmissions')
  assertRequiredFormFields(context.form_manifest, input.payload)

  const [submission] = await withTenant(context.tenant_id, tx => tx.insert(siteFormSubmissions).values({
    tenantId: context.tenant_id,
    siteId: context.site_id,
    pageId: context.page_id,
    connectionId: context.connection_id,
    formKey: input.formKey,
    payload: input.payload,
    originMetadata: input.origin
  }).returning())

  try {
    const fields = await withTenant(context.tenant_id, tx => tx.select({
      id: entityFields.id,
      name: entityFields.name,
      dataType: entityFields.dataType,
      validationRules: entityFields.validationRules,
      isRequired: entityFields.isRequired
    }).from(entityFields).where(eq(entityFields.entityId, context.entity_id))) as TargetField[]

    const { customData: mappedData, appliedMapping, appliedDefaults } = mapSiteFormPayload(
      input.payload,
      context.field_mapping ?? {},
      fields,
      context.default_values ?? {},
      context.value_mappings ?? {}
    )
    const dynamicSchema = await getEntityZodSchema(context.tenant_id, context.entity_id, {})
    const row = await withTenant(context.tenant_id, async tx => {
      let customData = await defaultRecordValues(tx, context.tenant_id, fields, stripCalculatedValues(fields, mappedData))
      for (const field of fields) {
        if (field.dataType !== 'incremental') continue
        customData[field.name] = await generateIncrementalValue(tx, context.tenant_id, field, customData)
      }
      customData = await applyCalculatedFields(tx, context.tenant_id, context.entity_id, customData, undefined, fields)
      const parsed = dynamicSchema.safeParse(customData)
      if (!parsed.success) {
        throw createError({ statusCode: 422, statusMessage: 'El formulario no cubre todos los campos requeridos del módulo de destino.', data: parsed.error.flatten() })
      }
      customData = parsed.data as Record<string, unknown>
      await assertWritableRelations(tx, context.tenant_id, fields, customData)
      const [record] = await tx.insert(records).values({
        entityId: context.entity_id,
        tenantId: context.tenant_id,
        customData
      }).returning()
      await recalculateCalculatedDependents(tx, context.tenant_id, context.entity_id, null, customData)
      await tx.insert(siteFormSubmissionTargets).values({
        tenantId: context.tenant_id,
        submissionId: submission.id,
        entityId: context.entity_id,
        recordId: record.id,
        action: 'created',
        mappingSnapshot: { fields: appliedMapping, defaults: appliedDefaults }
      })
      await tx.insert(recordActivities).values({
        tenantId: context.tenant_id,
        recordId: record.id,
        userId: null,
        actionType: 'FORM_SUBMISSION',
        details: {
          submissionId: submission.id,
          sourceType: 'sites_form',
          formKey: input.formKey,
          formName: context.form_manifest.name || input.formKey,
          origin: input.origin
        }
      })
      await tx.update(siteFormSubmissions).set({
        status: 'processed',
        processedAt: new Date(),
        errorMessage: null
      }).where(and(
        eq(siteFormSubmissions.id, submission.id),
        eq(siteFormSubmissions.tenantId, context.tenant_id)
      ))
      return record
    })

    fireTriggersForRecord(context.tenant_id, context.entity_id, 'on_create', row.id, row.customData as Record<string, unknown>)
    return { submissionId: submission.id, recordId: row.id }
  } catch (error) {
    const message = error instanceof MissingIncrementalPrefixError
      ? error.message
      : error instanceof Error ? error.message : 'No se pudo procesar la captura.'
    await withTenant(context.tenant_id, tx => tx.update(siteFormSubmissions).set({
      status: 'failed',
      errorMessage: message.slice(0, 1000),
      processedAt: new Date()
    }).where(and(
      eq(siteFormSubmissions.id, submission.id),
      eq(siteFormSubmissions.tenantId, context.tenant_id)
    )))
    throw error
  }
}
