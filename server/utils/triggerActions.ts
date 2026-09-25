import { templateRelationData } from '~/server/utils/templateRelations'
import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { and, eq, sql as dsql } from 'drizzle-orm'
import { withTenant, db } from '~/server/db'
import { entities, entityFields, recordActivities, recordRelations, records, relationDefinitions, triggerActionOutputs, triggerActions, triggerLogs, triggers } from '~/server/db/schema'
import { assertWritableRelations } from '~/server/utils/relationWriteGuard'
import { getEntityZodSchema } from '~/server/utils/dynamicSchema'
import { logger } from '~/server/utils/logger'
import { escapeHtml, getAppBaseUrl, resolveSmtpConfig, SmtpNotConfiguredError } from '~/server/utils/mailer'
import { enqueueEmail } from '~/server/utils/jobQueue'
import { createNotifications, publishNotifications } from '~/server/utils/notifications'
import { generateIncrementalValue } from '~/server/utils/incrementalField'
import { recordNotDeleted } from '~/server/utils/records'
import { applyCalculatedFields, isCalculatedField, recalculateCalculatedDependents, stripCalculatedValues } from '~/server/utils/calculatedFields'

// HU-ERD-49: ejecucion real de las acciones de un trigger que matcheo
// (ERD-48 solo resolvia QUE triggers disparan, nunca ejecutaba nada). Se
// llama SIEMPRE fuera de la transaccion HTTP original (fire-and-forget desde
// triggers.ts, igual que ERD-48) - un webhook caido nunca debe afectar el
// tiempo de respuesta de un create/update/delete de records.

export const MAX_ATTEMPTS = 5
const WEBHOOK_TIMEOUT_MS = 10_000

export type TriggerLogStatus = 'success' | 'failed' | 'retrying' | 'dead_letter'

export interface TriggerActionRow {
  id: string
  actionType: string
  config: unknown
  executionOrder: number
}

type WorkflowBranch = 'yes' | 'no' | undefined

// Config esperada por tipo de accion (JSONB de trigger_actions.config, ERD-47).
// .passthrough(): config puede crecer a futuro (ej. headers custom de webhook)
// sin que una clave extra rompa una accion ya configurada. Exportados desde
// HU-ERD-51 para que server/utils/triggerAdmin.ts valide la config al
// crear/editar una accion desde la UI de administracion, en vez de dejar que
// una config invalida solo se descubra en el primer disparo real.
export const webhookConfigSchema = z.object({ url: z.string().url(), secret: z.string().min(1).optional() }).passthrough()
export const updateFieldConfigSchema = z.object({ field: z.string().min(1), value: z.any() }).passthrough()
const recordFieldMappingSchema = z.object({ sourceField: z.string().min(1), targetField: z.string().min(1) }).strict()
export const upsertRecordConfigSchema = z.object({
  targetEntityId: z.string().uuid(),
  mappings: z.array(recordFieldMappingSchema).min(1),
  values: z.record(z.any()).default({}),
  matchBy: z.array(recordFieldMappingSchema).default([]),
  existingBehavior: z.enum(['update_and_link', 'link_only', 'fail']).default('update_and_link'),
  relationDefinitionId: z.string().uuid().nullable().optional()
}).passthrough()
// HU-ERD-50: to/subject/body admiten plantilla ({{campo}}, ver interpolateTemplate())
export const emailConfigSchema = z.object({ to: z.string().min(1), subject: z.string().min(1), body: z.string().min(1) }).passthrough()
// Las notificaciones del workflow se entregan a usuarios concretos o a todos
// los usuarios que pertenezcan a un rol. El label se guarda como snapshot para
// que el constructor pueda pintar las píldoras sin otra consulta, pero nunca
// se usa para autorizar: al ejecutar se vuelven a resolver los ids en el tenant.
export const notificationRecipientSchema = z.object({
  type: z.enum(['user', 'role']),
  id: z.string().uuid(),
  label: z.string().min(1).optional()
})
export const notificationConfigSchema = z.object({
  recipients: z.array(notificationRecipientSchema).min(1),
  title: z.string().min(1).max(160),
  message: z.string().min(1).max(4000)
}).passthrough()

interface ActionOutcome {
  ok: boolean
  // true = fallo transitorio (red, timeout, HTTP no-2xx) - candidato a
  // reintento. false = fallo permanente (config invalida, campo invalido,
  // registro inexistente) - reintentarlo daria el mismo error siempre.
  retryable: boolean
  responseStatus?: number
  error?: string
}

/** Snapshot de UN disparo de trigger - lo que se firma/manda al webhook y lo que queda en trigger_logs.request_payload para reusar tal cual en los reintentos. */
export interface TriggerPayload {
  trigger: { id: string; name: string }
  event: string
  record: { id: string; data: Record<string, unknown> }
  firedAt: string
}

/** Firma HMAC-SHA256 del body crudo (mismo texto que se manda en el POST) - HU-ERD-49. */
function signPayload(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

/**
 * Interpola `{{campo}}` dentro de un texto (asunto/cuerpo/destinatario de la
 * accion "email", HU-ERD-50) contra el customData del record que disparo el
 * trigger. Pura y exportada (mismo criterio que buildFieldType() en
 * dynamicSchema.ts, ERD-17/29) para poder testearla sin Postgres.
 *
 * Cada valor interpolado se escapa con escapeHtml() (mismo escapado que ya
 * usa el correo de invitacion de ERD-84) ANTES de insertarse en el texto -
 * el "campo" de un record es dato del usuario, nunca codigo/markup de
 * confianza (misma logica de sanitizacion que el resto del sistema aplica a
 * cualquier valor de usuario insertado en HTML). Un campo ausente en el
 * record se interpola como cadena vacia (no revienta la plantilla).
 */
export function interpolateTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+){0,3})\s*\}\}/g, (_match, fieldName: string) => {
    const value = data[fieldName]
    if (value === undefined || value === null) return ''
    const asString = typeof value === 'string' ? value : JSON.stringify(value)
    return escapeHtml(asString)
  })
}

// Las notificaciones se pintan como texto mediante Vue (que ya escapa el
// contenido al renderizar), así que no deben recibir entidades HTML como
// `&amp;` visibles en la bandeja. El correo conserva interpolateTemplate(),
// porque su cuerpo sí se envía como HTML.
function interpolateTextTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+){0,3})\s*\}\}/g, (_match, fieldName: string) => {
    const value = data[fieldName]
    if (value === undefined || value === null) return ''
    return typeof value === 'string' ? value : JSON.stringify(value)
  })
}

/**
 * Backoff exponencial en minutos: 2^intento (2, 4, 8, 16 min tras los
 * intentos 1-4 fallidos). El intento 5, si tambien falla, pasa a
 * dead_letter directo (ver resolveStatus) - no hay una 6ta espera.
 */
export function computeBackoffMs(attemptCount: number): number {
  return Math.pow(2, attemptCount) * 60_000
}

/** Estado final de un log tras un intento, segun el criterio de aceptacion (hasta MAX_ATTEMPTS, despues dead_letter). */
export function resolveStatus(anyFailed: boolean, anyRetryable: boolean, attemptCount: number): TriggerLogStatus {
  if (!anyFailed) return 'success'
  if (anyRetryable && attemptCount < MAX_ATTEMPTS) return 'retrying'
  if (anyRetryable) return 'dead_letter'
  return 'failed'
}

async function runWebhookAction(config: unknown, rawBody: string): Promise<ActionOutcome> {
  const parsed = webhookConfigSchema.safeParse(config)
  if (!parsed.success) {
    return { ok: false, retryable: false, error: 'Configuración de webhook inválida (falta "url" o no es una URL válida)' }
  }
  const secret = parsed.data.secret || process.env.TRIGGER_WEBHOOK_DEFAULT_SECRET
  if (!secret) {
    return { ok: false, retryable: false, error: 'No hay secreto para firmar el webhook (config.secret o TRIGGER_WEBHOOK_DEFAULT_SECRET)' }
  }

  const signature = signPayload(rawBody, secret)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
  try {
    const response = await fetch(parsed.data.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Trigger-Signature': `sha256=${signature}` },
      body: rawBody,
      signal: controller.signal
    })
    if (response.ok) {
      return { ok: true, retryable: false, responseStatus: response.status }
    }
    return { ok: false, retryable: true, responseStatus: response.status, error: `El webhook respondió HTTP ${response.status}` }
  } catch (err) {
    // Red caida, DNS, timeout (AbortError) - todo transitorio, candidato a reintento.
    return { ok: false, retryable: true, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Accion update_field: el valor configurado (config.value) se escribe en
 * customData[config.field] - SIEMPRE revalidado con el schema Zod dinamico
 * de la entidad (ERD-17) antes de guardar, para que un trigger mal
 * configurado nunca corrompa un registro (criterio de aceptacion explicito
 * de la HU). Un fallo aca es permanente (retryable: false) - reintentar sin
 * cambiar la configuracion del trigger daria el mismo error de validacion
 * cada vez.
 */
async function runUpdateFieldAction(tenantId: string, entityId: string, recordId: string, config: unknown): Promise<ActionOutcome> {
  const parsed = updateFieldConfigSchema.safeParse(config)
  if (!parsed.success) {
    return { ok: false, retryable: false, error: 'Configuración de update_field inválida (faltan "field"/"value")' }
  }

  return withTenant(tenantId, async (tx) => {
    const [sourceEntity] = await tx.select({ isActive: entities.isActive, deletedAt: entities.deletedAt })
      .from(entities).where(and(eq(entities.id, entityId), eq(entities.tenantId, tenantId))).limit(1)
    if (!sourceEntity?.isActive || sourceEntity.deletedAt) {
      return { ok: false, retryable: false, error: 'El módulo está deshabilitado' }
    }
    const [record] = await tx.select().from(records).where(and(eq(records.id, recordId), eq(records.tenantId, tenantId))).limit(1)
    if (!record) {
      return { ok: false, retryable: false, error: 'El registro ya no existe' }
    }

    const currentData = (record.customData ?? {}) as Record<string, unknown>
    const relationFields = await tx.select({ name: entityFields.name, dataType: entityFields.dataType, validationRules: entityFields.validationRules })
      .from(entityFields).where(eq(entityFields.entityId, entityId))
    if (relationFields.some(field => field.name === parsed.data.field && isCalculatedField(field))) {
      return { ok: false, retryable: false, error: `El campo "${parsed.data.field}" es calculado y no se puede sobrescribir` }
    }
    const merged = await applyCalculatedFields(tx, tenantId, entityId, { ...currentData, [parsed.data.field]: parsed.data.value }, recordId, relationFields)
    const schema = await getEntityZodSchema(tenantId, entityId)
    const validated = schema.safeParse(merged)
    if (!validated.success) return { ok: false, retryable: false, error: `El valor calculado no pasa la validación del campo "${parsed.data.field}": ${JSON.stringify(validated.error.flatten().fieldErrors)}` }
    try {
      await assertWritableRelations(tx, tenantId, relationFields, validated.data as Record<string, unknown>, currentData)
    } catch (error) {
      return { ok: false, retryable: false, error: error instanceof Error ? error.message : String(error) }
    }
    await tx.update(records).set({ customData: validated.data, updatedAt: new Date() }).where(eq(records.id, recordId))
    await recalculateCalculatedDependents(tx, tenantId, entityId, currentData, validated.data as Record<string, unknown>)
    return { ok: true, retryable: false }
  })
}

/** Crea o reutiliza un registro destino, lo vincula con el origen y conserva idempotencia por accion. */
async function runUpsertRecordAction(
  tenantId: string,
  sourceEntityId: string,
  actionId: string,
  sourceRecordId: string,
  config: unknown,
  sourceData: Record<string, unknown>
): Promise<ActionOutcome> {
  const parsed = upsertRecordConfigSchema.safeParse(config)
  if (!parsed.success) return { ok: false, retryable: false, error: 'Configuración de crear/actualizar registro inválida' }
  const settings = parsed.data

  const [targetEntity] = await withTenant(tenantId, tx => tx.select({
    id: entities.id,
    slug: entities.slug,
    isActive: entities.isActive,
    deletedAt: entities.deletedAt
  }).from(entities).where(and(eq(entities.id, settings.targetEntityId), eq(entities.tenantId, tenantId))).limit(1))
  if (!targetEntity?.isActive || targetEntity.deletedAt) return { ok: false, retryable: false, error: 'El módulo destino no existe o está deshabilitado' }

  const targetSchema = await getEntityZodSchema(tenantId, targetEntity.id)
  try {
    const result = await withTenant(tenantId, async tx => {
      const [priorOutput] = await tx.select({ targetRecordId: triggerActionOutputs.targetRecordId })
        .from(triggerActionOutputs)
        .where(and(eq(triggerActionOutputs.tenantId, tenantId), eq(triggerActionOutputs.triggerActionId, actionId), eq(triggerActionOutputs.sourceRecordId, sourceRecordId)))
        .limit(1)
      if (priorOutput?.targetRecordId) {
        const [existingTarget] = await tx.select({ id: records.id }).from(records)
          .where(and(eq(records.id, priorOutput.targetRecordId), eq(records.tenantId, tenantId), recordNotDeleted)).limit(1)
        if (existingTarget) return { targetId: existingTarget.id, created: false, reused: true }
      }

      const targetFields = await tx.select({
        id: entityFields.id,
        name: entityFields.name,
        label: entityFields.label,
        dataType: entityFields.dataType,
        validationRules: entityFields.validationRules
      }).from(entityFields).where(eq(entityFields.entityId, targetEntity.id))
      const fieldNames = new Set(targetFields.map(field => field.name))
      const configuredTargets = [...settings.mappings.map(item => item.targetField), ...Object.keys(settings.values), ...settings.matchBy.map(item => item.targetField)]
      const unknown = configuredTargets.filter(name => !fieldNames.has(name))
      if (unknown.length) throw new Error(`El módulo destino ya no contiene: ${[...new Set(unknown)].join(', ')}`)

      const mappedData: Record<string, unknown> = { ...settings.values }
      for (const mapping of settings.mappings) mappedData[mapping.targetField] = sourceData[mapping.sourceField]
      const writableMappedData = stripCalculatedValues(targetFields, mappedData)

      let target: typeof records.$inferSelect | undefined
      if (settings.matchBy.length) {
        const matchConditions = settings.matchBy.map(mapping => {
          const value = sourceData[mapping.sourceField]
          if (value === undefined || value === null || value === '') throw new Error(`Falta el dato de origen "${mapping.sourceField}" necesario para detectar duplicados`)
          return dsql`${records.customData}->>${mapping.targetField} = ${String(value)}`
        })
        const matches = await tx.select().from(records).where(and(
          eq(records.tenantId, tenantId),
          eq(records.entityId, targetEntity.id),
          recordNotDeleted,
          ...matchConditions
        )).limit(2)
        if (matches.length > 1) throw new Error('Hay más de un registro destino que coincide; no se puede elegir uno de forma segura')
        target = matches[0]
      }

      let created = false
      if (target) {
        if (settings.existingBehavior === 'fail') throw new Error('Ya existe un registro destino con los campos de coincidencia configurados')
        if (settings.existingBehavior === 'update_and_link') {
          const currentData = (target.customData ?? {}) as Record<string, unknown>
          const merged = await applyCalculatedFields(tx, tenantId, targetEntity.id, { ...currentData, ...writableMappedData }, target.id, targetFields)
          const validated = targetSchema.safeParse(merged)
          if (!validated.success) throw new Error(`El registro destino no cumple sus campos obligatorios: ${JSON.stringify(validated.error.flatten().fieldErrors)}`)
          await assertWritableRelations(tx, tenantId, targetFields, validated.data as Record<string, unknown>, currentData)
          const changes = Object.keys(validated.data as Record<string, unknown>).filter(field => JSON.stringify(currentData[field]) !== JSON.stringify((validated.data as Record<string, unknown>)[field])).map(field => ({ field, old: currentData[field], new: (validated.data as Record<string, unknown>)[field] }))
          if (changes.length) {
            ;[target] = await tx.update(records).set({ customData: validated.data, isDirty: false, updatedAt: new Date() }).where(eq(records.id, target.id)).returning()
            await tx.insert(recordActivities).values({ tenantId, recordId: target.id, userId: null, actionType: 'UPDATED', details: { changes, workflowActionId: actionId, sourceRecordId } })
            await recalculateCalculatedDependents(tx, tenantId, targetEntity.id, currentData, validated.data as Record<string, unknown>)
          }
        }
      } else {
        let preparedData = await applyCalculatedFields(tx, tenantId, targetEntity.id, writableMappedData, undefined, targetFields)
        const validated = targetSchema.safeParse(preparedData)
        if (!validated.success) throw new Error(`Faltan datos para crear el registro destino: ${JSON.stringify(validated.error.flatten().fieldErrors)}`)
        let customData = { ...(validated.data as Record<string, unknown>) }
        for (const field of targetFields) {
          if (field.dataType === 'incremental') customData[field.name] = await generateIncrementalValue(tx, tenantId, field, customData)
        }
        customData = await applyCalculatedFields(tx, tenantId, targetEntity.id, customData, undefined, targetFields)
        await assertWritableRelations(tx, tenantId, targetFields, customData)
        ;[target] = await tx.insert(records).values({ entityId: targetEntity.id, tenantId, customData }).returning()
        created = true
        await tx.insert(recordActivities).values({ tenantId, recordId: target.id, userId: null, actionType: 'CREATED', details: { customData, workflowActionId: actionId, sourceRecordId } })
        await recalculateCalculatedDependents(tx, tenantId, targetEntity.id, null, customData)
      }

      if (!target) throw new Error('No se pudo resolver el registro destino')

      if (settings.relationDefinitionId) {
        const [definition] = await tx.select().from(relationDefinitions).where(and(eq(relationDefinitions.id, settings.relationDefinitionId), eq(relationDefinitions.tenantId, tenantId))).limit(1)
        if (!definition) throw new Error('La relación configurada ya no existe')
        let sourceId = sourceRecordId
        let targetId = target.id
        if (definition.sourceEntityId === targetEntity.id && definition.targetEntityId === sourceEntityId) {
          sourceId = target.id
          targetId = sourceRecordId
        } else if (definition.sourceEntityId !== sourceEntityId || definition.targetEntityId !== targetEntity.id) {
          throw new Error('La relación configurada no conecta los módulos origen y destino')
        }
        const [existingLink] = await tx.select({ id: recordRelations.id }).from(recordRelations).where(and(
          eq(recordRelations.tenantId, tenantId),
          eq(recordRelations.relationDefinitionId, definition.id),
          eq(recordRelations.sourceRecordId, sourceId),
          eq(recordRelations.targetRecordId, targetId)
        )).limit(1)
        if (!existingLink) {
          await tx.insert(recordRelations).values({ tenantId, relationDefinitionId: definition.id, sourceRecordId: sourceId, targetRecordId: targetId })
          await tx.insert(recordActivities).values({ tenantId, recordId: sourceRecordId, userId: null, actionType: 'LINKED', details: { relationDefinitionId: definition.id, relatedRecordId: target.id, workflowActionId: actionId } })
        }
      }

      await tx.insert(triggerActionOutputs).values({
        tenantId,
        triggerActionId: actionId,
        sourceRecordId,
        targetRecordId: target.id,
        result: { created, targetEntityId: targetEntity.id }
      }).onConflictDoUpdate({
        target: [triggerActionOutputs.triggerActionId, triggerActionOutputs.sourceRecordId],
        set: { targetRecordId: target.id, result: { created, targetEntityId: targetEntity.id }, updatedAt: new Date() }
      })
      return { targetId: target.id, created, reused: false, data: target.customData as Record<string, unknown> }
    })

    if (result.created && result.data) {
      const { fireTriggersForRecord } = await import('~/server/utils/triggers')
      fireTriggersForRecord(tenantId, targetEntity.id, 'on_create', result.targetId, result.data)
    }
    return { ok: true, retryable: false }
  } catch (error) {
    return { ok: false, retryable: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function runEmailAction(tenantId: string, config: unknown, data: Record<string, unknown>, recordUrl?: string): Promise<ActionOutcome> {
  const parsed = emailConfigSchema.safeParse(config)
  if (!parsed.success) {
    return { ok: false, retryable: false, error: 'Configuración de email inválida (faltan "to"/"subject"/"body")' }
  }

  const to = interpolateTemplate(parsed.data.to, data)
  const subject = interpolateTemplate(parsed.data.subject, data)
  const html = interpolateTemplate(parsed.data.body, data)

  if (!z.string().email().safeParse(to).success) {
    return { ok: false, retryable: false, error: `El destinatario interpolado no es un correo válido: "${to}"` }
  }

  // El correo se encola: sale a un ritmo controlado y con reintentos propios
  // (server/utils/jobQueue.ts). "Éxito" aquí significa "aceptado en la cola"; un
  // fallo posterior queda visible en Ajustes > Correo saliente.
  try {
    // Revisión previa: si el correo no está configurado (o el dominio no está
    // verificado / SES pausó el envío) se informa ya en el registro del disparador,
    // en vez de descubrirlo horas después en la cola.
    await resolveSmtpConfig(tenantId)
    await enqueueEmail(tenantId, { to, subject, html, recordUrl })
    return { ok: true, retryable: false }
  } catch (err) {
    if (err instanceof SmtpNotConfiguredError) return { ok: false, retryable: false, error: err.message }
    return { ok: false, retryable: true, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Acción de notificación: crea una notificación in-app por usuario y publica
 * las filas recién insertadas en el bus SSE. Los roles se expanden dentro de
 * createNotifications, siempre filtrando por tenant y usuarios activos.
 */
async function runNotificationAction(
  tenantId: string,
  config: unknown,
  data: Record<string, unknown>,
  entitySlug?: string,
  recordId?: string,
  recordUrl?: string
): Promise<ActionOutcome> {
  const parsed = notificationConfigSchema.safeParse(config)
  if (!parsed.success) {
    return { ok: false, retryable: false, error: 'Configuración de notificación inválida (agrega destinatarios, título y mensaje)' }
  }

  const title = interpolateTextTemplate(parsed.data.title, data)
  const message = interpolateTextTemplate(parsed.data.message, data)
  const userIds = parsed.data.recipients.filter(recipient => recipient.type === 'user').map(recipient => recipient.id)
  const roleIds = parsed.data.recipients.filter(recipient => recipient.type === 'role').map(recipient => recipient.id)

  try {
    const rows = await withTenant(tenantId, tx => createNotifications(tx, {
      tenantId,
      entitySlug,
      recordId,
      actionUrl: recordUrl,
      type: 'WORKFLOW',
      title,
      message,
      recipients: { userIds, roleIds }
    }))
    if (!rows.length) {
      return { ok: false, retryable: false, error: 'La notificación no tiene destinatarios activos disponibles.' }
    }
    publishNotifications(rows)
    return { ok: true, retryable: false }
  } catch (error) {
    return { ok: false, retryable: false, error: error instanceof Error ? error.message : 'No se pudo crear la notificación.' }
  }
}

async function fetchOrderedActions(tenantId: string, triggerId: string): Promise<TriggerActionRow[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select({ id: triggerActions.id, actionType: triggerActions.actionType, config: triggerActions.config, executionOrder: triggerActions.executionOrder })
      .from(triggerActions)
      .where(eq(triggerActions.triggerId, triggerId))
      .orderBy(triggerActions.executionOrder)
  )
}

/**
 * Corre TODAS las acciones de un trigger, en orden. Deliberadamente NO se
 * detiene en la primera que falla (acciones independientes entre si) - junta
 * el ultimo error/responseStatus para el log. Cada llamada usa su propia
 * transaccion corta (withTenant) por accion que la necesita - nunca una
 * transaccion unica para todo el pipeline, para no dejar abierta una
 * conexion mientras se espera un webhook externo (hasta 10s).
 */
async function runActionsPipeline(
  tenantId: string,
  entityId: string,
  recordId: string | null,
  actions: TriggerActionRow[],
  payload: TriggerPayload,
  branch?: WorkflowBranch
): Promise<{ anyFailed: boolean; anyRetryable: boolean; lastError?: string; lastResponseStatus?: number }> {
  const rawBody = JSON.stringify(payload)
  const templateData = payload.record?.data ?? {}

  let anyFailed = false
  let anyRetryable = false
  let lastError: string | undefined
  let lastResponseStatus: number | undefined

  const [entity] = await withTenant(tenantId, tx => tx.select({ slug: entities.slug }).from(entities).where(and(eq(entities.id, entityId), eq(entities.tenantId, tenantId))).limit(1))
  const recordPath = entity && recordId ? `/registros/${entity.slug}/${recordId}` : undefined
  const recordUrl = recordPath ? `${getAppBaseUrl()}${recordPath}` : undefined
  const branchActions = branch === undefined ? actions : actions.filter(action => {
    const actionBranch = (action.config as { branch?: WorkflowBranch } | null)?.branch
    return !actionBranch || actionBranch === branch
  })
  for (const action of branchActions) {
    let outcome: ActionOutcome
    if (action.actionType === 'webhook') {
      outcome = await runWebhookAction(action.config, rawBody)
    } else if (action.actionType === 'update_field') {
      outcome = recordId
        ? await runUpdateFieldAction(tenantId, entityId, recordId, action.config)
        : { ok: false, retryable: false, error: 'El registro ya no existe' }
    } else if (action.actionType === 'upsert_record') {
      outcome = recordId
        ? await runUpsertRecordAction(tenantId, entityId, action.id, recordId, action.config, templateData)
        : { ok: false, retryable: false, error: 'El registro origen ya no existe' }
    } else if (action.actionType === 'email') {
      try {
        const config = action.config as Record<string, unknown>
        const resolved = await templateRelationData(tenantId, entityId, templateData, [String(config.to ?? ''), String(config.subject ?? ''), String(config.body ?? '')])
        outcome = await runEmailAction(tenantId, action.config, resolved, recordUrl)
      } catch (error) { outcome = { ok: false, retryable: false, error: error instanceof Error ? error.message : 'No se pudieron resolver las variables.' } }
    } else if (action.actionType === 'notification') {
      try {
        const config = action.config as Record<string, unknown>
        const resolved = await templateRelationData(tenantId, entityId, templateData, [String(config.title ?? ''), String(config.message ?? '')])
        outcome = await runNotificationAction(tenantId, action.config, resolved, entity?.slug, recordId ?? undefined, recordPath)
      } catch (error) { outcome = { ok: false, retryable: false, error: error instanceof Error ? error.message : 'No se pudieron resolver las variables.' } }
    } else {
      // Tipos futuros: hasta que existan, marcados como fallo permanente
      // explicito - nunca silencioso.
      outcome = { ok: false, retryable: false, error: `Tipo de acción "${action.actionType}" todavía no implementado` }
    }

    if (!outcome.ok) {
      anyFailed = true
      if (outcome.retryable) anyRetryable = true
      lastError = outcome.error
    }
    if (outcome.responseStatus !== undefined) lastResponseStatus = outcome.responseStatus
  }

  return { anyFailed, anyRetryable, lastError, lastResponseStatus }
}

/**
 * Primer intento de ejecucion, llamado desde triggers.ts justo despues de
 * que evaluateTriggersForRecord() confirma que este trigger matcheo. Arma el
 * payload UNA vez (mismo que se firma/manda al webhook y el que se reusa tal
 * cual en cada reintento, via trigger_logs.request_payload - nunca se vuelve
 * a leer el record desde cero en un reintento, para no mandar datos
 * distintos a los que originaron el disparo).
 */
export async function executeTriggerActions(
  tenantId: string,
  entityId: string,
  triggerId: string,
  triggerName: string,
  recordId: string,
  event: string,
  customData: Record<string, unknown>,
  previousData?: Record<string, unknown>,
  decision?: boolean
): Promise<void> {
  const actions = await fetchOrderedActions(tenantId, triggerId)
  const payload = {
    trigger: { id: triggerId, name: triggerName },
    event,
    record: { id: recordId, data: customData },
    firedAt: new Date().toISOString()
  }

  if (actions.length === 0) {
    // Trigger sin ninguna accion configurada todavia - nada que ejecutar,
    // pero igual se deja un log (visibilidad en la futura UI de ERD-51).
    await withTenant(tenantId, (tx) =>
      tx.insert(triggerLogs).values({ tenantId, triggerId, recordId, status: 'success', attemptCount: 0, requestPayload: payload })
    )
    return
  }

  const { anyFailed, anyRetryable, lastError, lastResponseStatus } = await runActionsPipeline(tenantId, entityId, recordId, actions, payload, decision === undefined ? undefined : decision ? 'yes' : 'no')
  const status = resolveStatus(anyFailed, anyRetryable, 1)

  await withTenant(tenantId, (tx) =>
    tx.insert(triggerLogs).values({
      tenantId,
      triggerId,
      recordId,
      status,
      attemptCount: 1,
      lastError: lastError ?? null,
      requestPayload: payload,
      responseStatus: lastResponseStatus ?? null
    })
  )

  logger.info('trigger_action_executed', { tenantId, triggerId, recordId, status, attemptCount: 1 })
}

/**
 * Reintenta un trigger_logs existente (llamado desde el job de node-cron,
 * server/plugins/trigger-retries.ts, SIN `options.force` - solo actua sobre
 * status 'retrying', respetando el backoff ya calculado por el caller). Reusa
 * el request_payload guardado en el intento original - nunca vuelve a leer el
 * record (que pudo cambiar desde entonces): el reintento es "reenviar lo
 * mismo que ya se decidió disparar", no "recalcular con datos nuevos".
 *
 * `options.force` (HU-ERD-51, "botón de reintento manual" desde la UI de
 * administración de triggers): permite reintentar tambien un log en 'failed'
 * o 'dead_letter' - un administrador que ya corrigio la causa (ej. arreglo la
 * URL del webhook, completo el SMTP) necesita poder forzar un reintento sin
 * esperar a que el job automatico lo levante (que de por si NUNCA toca esos
 * dos estados). Un log 'success' nunca se reintenta, con o sin force - no hay
 * nada que reintentar.
 */
export async function retryTriggerLog(tenantId: string, logId: string, options: { force?: boolean } = {}): Promise<void> {
  const [log] = await withTenant(tenantId, (tx) =>
    tx.select().from(triggerLogs).where(and(eq(triggerLogs.id, logId), eq(triggerLogs.tenantId, tenantId))).limit(1)
  )
  if (!log) return
  if (log.status === 'success') return
  if (log.status !== 'retrying' && !options.force) return

  const [trigger] = await withTenant(tenantId, (tx) =>
    tx.select({ id: triggers.id, name: triggers.name, entityId: triggers.entityId }).from(triggers).where(eq(triggers.id, log.triggerId)).limit(1)
  )
  if (!trigger) {
    await withTenant(tenantId, (tx) =>
      tx.update(triggerLogs).set({ status: 'dead_letter', lastError: 'El trigger ya no existe', updatedAt: new Date() }).where(eq(triggerLogs.id, logId))
    )
    return
  }

  const actions = await fetchOrderedActions(tenantId, trigger.id)
  const payload = (log.requestPayload ?? { trigger: { id: trigger.id, name: trigger.name }, event: '', record: { id: log.recordId ?? '', data: {} }, firedAt: '' }) as TriggerPayload
  const attemptCount = log.attemptCount + 1

  const { anyFailed, anyRetryable, lastError, lastResponseStatus } = await runActionsPipeline(tenantId, trigger.entityId, log.recordId, actions, payload)
  const status = resolveStatus(anyFailed, anyRetryable, attemptCount)

  await withTenant(tenantId, (tx) =>
    tx
      .update(triggerLogs)
      .set({ status, attemptCount, lastError: lastError ?? null, responseStatus: lastResponseStatus ?? null, updatedAt: new Date() })
      .where(eq(triggerLogs.id, logId))
  )

  logger.info('trigger_action_retried', { tenantId, triggerId: trigger.id, logId, status, attemptCount })
}



/** Recorre reintentos pendientes con una sola consulta masiva (ERD-87). */
export async function runTriggerRetries(now: Date = new Date(), options: { limit?: number; budgetMs?: number } = {}): Promise<{ due: number; retried: number; failed: number; durationMs: number }> {
  const limit = options.limit ?? 200
  const budgetMs = options.budgetMs ?? 40_000
  const startTime = performance.now()
  let retried = 0
  let failed = 0
  
  const rawRows = await db.execute(dsql`
    SELECT id, tenant_id FROM due_trigger_retries(${now.toISOString()}::timestamptz, ${limit}::int)
  `)
  const dueLogs = [...rawRows] as { id: string; tenant_id: string }[]

  for (const log of dueLogs) {
    if (performance.now() - startTime >= budgetMs) {
      break
    }
    try {
      await retryTriggerLog(log.tenant_id, log.id)
      retried++
    } catch (err) {
      failed++
      logger.error('trigger_retry_tenant_failed', { tenantId: log.tenant_id, logId: log.id, errorMessage: err instanceof Error ? err.message : String(err) })
    }
  }

  const durationMs = performance.now() - startTime
  return { due: dueLogs.length, retried, failed, durationMs }
}
