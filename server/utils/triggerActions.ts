import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { withTenant, db } from '~/server/db'
import { records, tenants, triggers, triggerActions, triggerLogs } from '~/server/db/schema'
import { getEntityZodSchema } from '~/server/utils/dynamicSchema'
import { logger } from '~/server/utils/logger'
import { escapeHtml, sendPlainEmail, SmtpNotConfiguredError } from '~/server/utils/mailer'

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

// Config esperada por tipo de accion (JSONB de trigger_actions.config, ERD-47).
// .passthrough(): config puede crecer a futuro (ej. headers custom de webhook)
// sin que una clave extra rompa una accion ya configurada. Exportados desde
// HU-ERD-51 para que server/utils/triggerAdmin.ts valide la config al
// crear/editar una accion desde la UI de administracion, en vez de dejar que
// una config invalida solo se descubra en el primer disparo real.
export const webhookConfigSchema = z.object({ url: z.string().url(), secret: z.string().min(1).optional() }).passthrough()
export const updateFieldConfigSchema = z.object({ field: z.string().min(1), value: z.any() }).passthrough()
// HU-ERD-50: to/subject/body admiten plantilla ({{campo}}, ver interpolateTemplate())
export const emailConfigSchema = z.object({ to: z.string().min(1), subject: z.string().min(1), body: z.string().min(1) }).passthrough()

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
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, fieldName: string) => {
    const value = data[fieldName]
    if (value === undefined || value === null) return ''
    const asString = typeof value === 'string' ? value : JSON.stringify(value)
    return escapeHtml(asString)
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
    const [record] = await tx.select().from(records).where(and(eq(records.id, recordId), eq(records.tenantId, tenantId))).limit(1)
    if (!record) {
      return { ok: false, retryable: false, error: 'El registro ya no existe' }
    }

    const currentData = (record.customData ?? {}) as Record<string, unknown>
    const merged = { ...currentData, [parsed.data.field]: parsed.data.value }

    const schema = await getEntityZodSchema(tenantId, entityId)
    const validated = schema.safeParse(merged)
    if (!validated.success) {
      return { ok: false, retryable: false, error: `El valor calculado no pasa la validación del campo "${parsed.data.field}": ${JSON.stringify(validated.error.flatten().fieldErrors)}` }
    }

    await tx.update(records).set({ customData: validated.data, updatedAt: new Date() }).where(eq(records.id, recordId))
    return { ok: true, retryable: false }
  })
}

/**
 * Accion email: envia `config.subject`/`config.body` (HTML) a `config.to`,
 * los tres interpolados contra el customData del record que disparo el
 * trigger (interpolateTemplate(), con escapado - HU-ERD-50). Reusa
 * server/utils/mailer.ts (SMTP configurado por variables de entorno, ERD-84)
 * en vez de un proveedor de terceros - mismo criterio de "sin dependencia
 * externa obligatoria" que pide la HU.
 *
 * Un SMTP sin configurar, o un "to" interpolado que no da un correo valido,
 * son fallos PERMANENTES (config o datos del record que no van a cambiar
 * solos entre un intento y el siguiente). Un error real de SMTP (conexion,
 * autenticacion, timeout del propio servidor) es transitorio - mismo
 * criterio de reintento que un webhook caido.
 */
async function runEmailAction(config: unknown, data: Record<string, unknown>): Promise<ActionOutcome> {
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

  try {
    await sendPlainEmail({ to, subject, html })
    return { ok: true, retryable: false }
  } catch (err) {
    if (err instanceof SmtpNotConfiguredError) {
      return { ok: false, retryable: false, error: err.message }
    }
    return { ok: false, retryable: true, error: err instanceof Error ? err.message : String(err) }
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
  payload: TriggerPayload
): Promise<{ anyFailed: boolean; anyRetryable: boolean; lastError?: string; lastResponseStatus?: number }> {
  const rawBody = JSON.stringify(payload)
  const templateData = payload.record?.data ?? {}

  let anyFailed = false
  let anyRetryable = false
  let lastError: string | undefined
  let lastResponseStatus: number | undefined

  for (const action of actions) {
    let outcome: ActionOutcome
    if (action.actionType === 'webhook') {
      outcome = await runWebhookAction(action.config, rawBody)
    } else if (action.actionType === 'update_field') {
      outcome = recordId
        ? await runUpdateFieldAction(tenantId, entityId, recordId, action.config)
        : { ok: false, retryable: false, error: 'El registro ya no existe' }
    } else if (action.actionType === 'email') {
      outcome = await runEmailAction(action.config, templateData)
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
  customData: Record<string, unknown>
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

  const { anyFailed, anyRetryable, lastError, lastResponseStatus } = await runActionsPipeline(tenantId, entityId, recordId, actions, payload)
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

/** Reintentos vencidos de UN tenant (backoff calculado en JS desde updated_at - sin columna next_attempt_at propia, ver DOCS/comentario del plugin). */
export async function runTriggerRetriesForTenant(tenantId: string, now: Date): Promise<{ checked: number; retried: number }> {
  const dueRows = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: triggerLogs.id, attemptCount: triggerLogs.attemptCount, updatedAt: triggerLogs.updatedAt })
      .from(triggerLogs)
      .where(and(eq(triggerLogs.tenantId, tenantId), eq(triggerLogs.status, 'retrying')))
  )

  let retried = 0
  for (const row of dueRows) {
    const dueAt = row.updatedAt.getTime() + computeBackoffMs(row.attemptCount)
    if (now.getTime() >= dueAt) {
      await retryTriggerLog(tenantId, row.id)
      retried++
    }
  }
  return { checked: dueRows.length, retried }
}

/** Recorre todos los tenants (mismo patron que runOlapEtl(), ERD-28) - un tenant que falla no interrumpe a los demas. */
export async function runTriggerRetries(now: Date = new Date()): Promise<Array<{ tenantId: string; checked: number; retried: number }>> {
  const allTenants = await db.select({ id: tenants.id }).from(tenants)
  const results: Array<{ tenantId: string; checked: number; retried: number }> = []

  for (const tenant of allTenants) {
    try {
      const result = await runTriggerRetriesForTenant(tenant.id, now)
      results.push({ tenantId: tenant.id, ...result })
    } catch (err) {
      logger.error('trigger_retry_tenant_failed', { tenantId: tenant.id, errorMessage: err instanceof Error ? err.message : String(err) })
    }
  }
  return results
}
