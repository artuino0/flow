import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db, withTenant } from '~/server/db'
import { agendaPublicBookings, agendaSchedules, agendaSiteSettings, entities, entityFields, jobQueue, people, records, recordActivities, roles, siteDomains, sitePages, sites, users } from '~/server/db/schema'
import { agendaSiteSettingsSchema, normalizeAgendaPhone, type AgendaSiteConfig, type PublicBook, type PublicReschedule } from '~/utils/agendaPublic'
import { agendaStaff } from './agendaStaff'
import { agendaAccentPresentation } from '~/utils/agendaAccent'
import { agendaActor, agendaBaseInTx, agendaSettingsInTx } from './agendaAdmin'
import { availabilityInTx, reserveSlotInTx } from './agendaAvailability'
import { addAgendaDays, localAt, localInstant } from './agendaEngine'
import { agendaFormToken, agendaHash, agendaOpaqueId, canManageAgenda, newAgendaToken, publicAgendaNotFound, validAgendaFormToken } from './agendaPublicSecurity'
import { withSystemRecordAccess } from './recordActorContext'
import { getEntityZodSchema } from './dynamicSchema'
import { enqueueCriticalEmailInTx, sendQueuedCriticalEmail } from './criticalEmail'
import { emailQuota } from './jobQueue'
import { assertWritableRelations } from './relationWriteGuard'
import { fireTriggersForRecord } from './triggers'
import { getPublicAppBaseUrl } from './publicUrls'
import { defaultRecordValues } from './fieldValidations/references'
import { generateIncrementalValue } from './incrementalField'
import { applyCalculatedFields, recalculateCalculatedDependents } from './calculatedFields'
import type { AuthTokenPayload } from './auth'
import { agendaTurnstileKey, verifyAgendaTurnstile } from './agendaTurnstile'
import { agendaPrivateKey } from './agendaPersistentLimit'
import { expireAgendaConfirmations } from './agendaConfirmation'
import { stateWorkflowSchema } from './stateWorkflow'

export interface PublicAgendaOrigin { origin: string; host: string; ip: string; userAgent: string }
function unavailableAgenda(reason: string): never {
  // Motivos fijos, sin URL, cabeceras, tokens ni datos del visitante.
  if (process.env.NODE_ENV !== 'production') console.warn(`[Agenda pública] ${reason}`)
  throw publicAgendaNotFound()
}
// Origen de Flow explícito; no confiar en X-Forwarded-Host ni en el cuerpo.
export function agendaFlowOrigin() {
  const deployed = process.env.NODE_ENV === 'production' || process.env.RAILWAY_PROJECT_ID || process.env.VERCEL
  const url = new URL(process.env.APP_BASE_URL || (deployed ? getPublicAppBaseUrl() : 'http://localhost:3000'))
  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) throw publicAgendaNotFound()
  return url.origin
}
function verifiedOrigin(input: PublicAgendaOrigin) {
  let url: URL
  try { url = new URL(input.origin) } catch { return unavailableAgenda(input.origin ? 'Origen inválido o null.' : 'Sin origen: faltan Origin y Referer válido.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== input.origin) return unavailableAgenda('Origen no canónico o protocolo inválido.')
  if (url.host.toLowerCase() !== input.host.toLowerCase()) return unavailableAgenda('El origen no coincide con Host.')
  return { hostname: url.hostname.toLowerCase(), flow: url.origin === agendaFlowOrigin(), origin: url.origin }
}
export async function resolveAgendaContext(site: string, page: string, origin: PublicAgendaOrigin) {
  const verified = verifiedOrigin(origin)
  const rows = await db.execute(sql`select * from resolve_public_agenda(${site}::uuid,${page}::uuid,${verified.hostname},${verified.flow})`)
  const tenantId = rows[0]?.tenant_id
  if (!tenantId) return unavailableAgenda('Resolución pública rechazada: sitio/página/versión no publicados, agenda desactivada o dominio no autorizado.')
  if (!verified.flow) {
    // Comprobación explícita del argumento hostname: no depender de la
    // resolución de nombres de columnas/argumentos del resolver SQL.
    const activeDomain = await withTenant(String(tenantId), async tx => tx.select({ id: siteDomains.id }).from(siteDomains)
      .where(and(eq(siteDomains.tenantId, String(tenantId)), eq(siteDomains.siteId, site), eq(siteDomains.hostname, verified.hostname), eq(siteDomains.status, 'active'))).limit(1))
    if (!activeDomain.length) return unavailableAgenda('El dominio no está activo para este sitio.')
  }
  return { tenantId: String(tenantId), site, page, origin: verified.origin, fingerprint: agendaHash(`${String(tenantId)}:${origin.ip}`), userAgent: origin.userAgent.slice(0, 300) }
}
export type PublicAgendaContext = Awaited<ReturnType<typeof resolveAgendaContext>>
export async function publicAgendaPresentation(context: PublicAgendaContext, locale: string) {
  return withSystemRecordAccess(() => withTenant(context.tenantId, async tx => {
    const catalog = await catalogInTx(tx, context)
    const accent = agendaAccentPresentation(catalog.config.accent, catalog.config.accentColor).css
    return { enabled: true, mode: catalog.mode, services: catalog.services.map(s => ({ id: agendaOpaqueId(context.site, 'service', s.id), name: s.name })),
      people: catalog.people.map(p => ({ id: agendaOpaqueId(context.site, 'person', p.id), name: p.name })),
      runtime: { site: context.site, page: context.page, locale, accent, timezone: catalog.timezone, assignmentMode: catalog.mode, maxDaysAhead: catalog.settings.maxDaysAhead, fields: catalog.config.visibleFields, ...(agendaTurnstileKey(catalog.config) ? { turnstileSiteKey: agendaTurnstileKey(catalog.config) } : {}) } }
  }))
}
async function catalogInTx(tx: typeof db, context: PublicAgendaContext) {
  const { tenantId, site, page } = context
  const [published] = await tx.select({ id: sites.id }).from(sites).innerJoin(sitePages, and(eq(sitePages.siteId, sites.id), eq(sitePages.tenantId, sites.tenantId)))
    .where(and(eq(sites.id, site), eq(sites.tenantId, tenantId), eq(sites.status, 'published'), eq(sitePages.id, page), eq(sitePages.status, 'published'), sql`${sitePages.publishedVersionId} is not null`)).limit(1)
  const [setting] = await tx.select().from(agendaSiteSettings).where(and(eq(agendaSiteSettings.siteId, site), eq(agendaSiteSettings.tenantId, tenantId))).limit(1)
  if (!published) return unavailableAgenda('Sitio o página no publicados.')
  if (!setting) return unavailableAgenda('El sitio no tiene configuración de agenda.')
  const config = agendaSiteSettingsSchema.parse(setting.config)
  if (!config.enabled) return unavailableAgenda('Agenda desactivada.')
  const base = await agendaBaseInTx(tx, tenantId)
  if (!base) return unavailableAgenda('No existe Citas base.')
  const staff = await agendaStaff(tx, tenantId)
  const visible = staff.filter(person => (!config.personalIds.length || config.personalIds.includes(person.id)) && person.name?.trim())
  const scheduled = await tx.select({ userId: agendaSchedules.userId }).from(agendaSchedules).where(eq(agendaSchedules.tenantId, tenantId))
  if (!visible.some(person => scheduled.some(row => row.userId === person.id))) return unavailableAgenda('No hay personas visibles con horario.')
  const services = await tx.select({ id: records.id, data: records.customData }).from(records).innerJoin(entities, eq(entities.id, records.entityId))
    .where(and(eq(records.tenantId, tenantId), eq(entities.tenantId, tenantId), eq(entities.slug, 'agenda-servicios'), eq(entities.templateKey, 'agenda'), eq(entities.isActive, true), isNull(entities.deletedAt), isNull(records.deletedAt)))
  const publicServices = services.filter(service => !config.serviceIds.length || config.serviceIds.includes(service.id)).map(service => {
    const data = service.data as Record<string, unknown>
    return { id: service.id, name: String(data.nombre ?? '').slice(0, 160), duration: Number(data.duracion_minutos), price: String(data.precio ?? '0') }
  }).filter(service => service.name && Number.isInteger(service.duration) && service.duration > 0 && service.duration <= 1440)
  if (!publicServices.length) return unavailableAgenda('No hay servicios públicos válidos.')
  const { settings, timezone } = await agendaSettingsInTx(tx, tenantId)
  return { config, base, people: visible.map(person => ({ id: person.id, name: person.name!, email: person.email })), services: publicServices, mode: config.assignmentMode ?? settings.assignmentMode, settings, timezone }
}
type Catalog = Awaited<ReturnType<typeof catalogInTx>>
function selectServices(catalog: Catalog, context: PublicAgendaContext, ids: string[]) {
  const selected = ids.map(id => catalog.services.find(service => agendaOpaqueId(context.site, 'service', service.id) === id))
  if (selected.some(service => !service)) throw publicAgendaNotFound()
  return selected.map(service => service!)
}
function selectPerson(catalog: Catalog, context: PublicAgendaContext, id: string) {
  if (id === 'any') { if (catalog.mode === 'client_chooses') throw publicAgendaNotFound(); return undefined }
  if (catalog.mode === 'auto') throw publicAgendaNotFound()
  const person = catalog.people.find(person => agendaOpaqueId(context.site, 'person', person.id) === id)
  if (!person) throw publicAgendaNotFound()
  return person.id
}
function publicConfirmation(catalog: Catalog, context: PublicAgendaContext, data: Record<string, unknown>, serviceIds: string[]) {
  const person = catalog.people.find(person => person.id === data.personal)
  return { date: String(data.fecha), time: String(data.hora), timezone: catalog.timezone,
    services: serviceIds.map(id => catalog.services.find(service => service.id === id)?.name ?? 'Servicio'), personal: person?.name ?? 'Personal', message: catalog.config.confirmationMessage }
}
async function availabilityFor(tx: typeof db, context: PublicAgendaContext, catalog: Catalog, from: string, to: string, serviceIds: string[], personal?: string, now = Date.now()) {
  const today = localAt(now, catalog.timezone).slice(0, 10)
  if (from < today || to > addAgendaDays(today, catalog.settings.maxDaysAhead)) throw createError({ statusCode: 422, statusMessage: 'Solicitud inválida.' })
  return availabilityInTx(tx, context.tenantId, { from, to, service: serviceIds.join(','), personal }, now, { people: catalog.people, assignmentMode: catalog.mode })
}
export async function publicAgendaSlots(context: PublicAgendaContext, input: { from: string; to: string; service?: string; personal?: string }, now = Date.now()) {
  await expireAgendaConfirmations(context.tenantId, now)
  return withSystemRecordAccess(() => withTenant(context.tenantId, async tx => {
    const catalog = await catalogInTx(tx, context)
    const services = input.service ? selectServices(catalog, context, [input.service]) : [catalog.services[0]!]
    const person = input.personal ? selectPerson(catalog, context, input.personal) : undefined
    const available = await availabilityFor(tx, context, catalog, input.from, input.to, services.map(service => service.id), person, now)
    const map = (slot: typeof available.slots[number], automatic = false) => ({ date: slot.date, time: slot.time, timezone: catalog.timezone,
      personal: automatic ? 'any' : agendaOpaqueId(context.site, 'person', slot.userId), ...(automatic ? {} : { name: catalog.people.find(person => person.id === slot.userId)!.name }) })
    return { slots: input.personal === 'any' ? [] : available.slots.map(slot => map(slot)), automatic: person ? [] : available.automatic.map(slot => map(slot, true)),
      services: catalog.services.map(service => ({ id: agendaOpaqueId(context.site, 'service', service.id), name: service.name, duration: service.duration })),
      people: catalog.mode === 'auto' ? [] : catalog.people.map(person => ({ id: agendaOpaqueId(context.site, 'person', person.id), name: person.name })),
      mode: catalog.mode, requiredFields: catalog.config.requiredFields, requireConsent: catalog.config.requireConsent, accent: catalog.config.accent,
      cancellationHours: catalog.config.cancellationHours, formToken: agendaFormToken(context.site, context.page, now) }
  }))
}

async function clientMetadata(tx: typeof db, tenantId: string, baseId: string, config: AgendaSiteConfig) {
  const [relation] = await tx.select({ rules: entityFields.validationRules }).from(entityFields).where(and(eq(entityFields.entityId, baseId), eq(entityFields.name, 'cliente'))).limit(1)
  const slug = (relation?.rules as { relationEntity?: string })?.relationEntity
  if (!slug) throw publicAgendaNotFound()
  const [client] = await tx.select().from(entities).where(and(eq(entities.tenantId, tenantId), eq(entities.slug, slug), eq(entities.isActive, true), isNull(entities.deletedAt))).limit(1)
  if (!client) throw publicAgendaNotFound()
  const fields = await tx.select().from(entityFields).where(eq(entityFields.entityId, client.id))
  if (Object.values(config.clientFields).some(name => !fields.some(field => field.name === name && field.dataType === 'text'))) throw publicAgendaNotFound()
  return { entityId: client.id, slug, fields }
}
async function prepare(context: PublicAgendaContext) {
  const info = await withSystemRecordAccess(() => withTenant(context.tenantId, async tx => {
    const catalog = await catalogInTx(tx, context)
    const [lines] = await tx.select({ id: entities.id }).from(entities).where(and(eq(entities.tenantId, context.tenantId), eq(entities.slug, 'agenda-servicios-cita'), eq(entities.templateKey, 'agenda'), eq(entities.isActive, true), isNull(entities.deletedAt))).limit(1)
    if (!lines) throw publicAgendaNotFound()
    const lineFields = await tx.select().from(entityFields).where(eq(entityFields.entityId, lines.id))
    return { catalog, client: await clientMetadata(tx, context.tenantId, catalog.base.id, catalog.config), lines, lineFields }
  }))
  const [schema, clientSchema, lineSchema, quota] = await Promise.all([getEntityZodSchema(context.tenantId, info.catalog.base.id), getEntityZodSchema(context.tenantId, info.client.entityId), getEntityZodSchema(context.tenantId, info.lines.id), emailQuota(context.tenantId)])
  return { ...info, schema, clientSchema, lineSchema, quota }
}
async function writeServiceLines(tx: typeof db, context: PublicAgendaContext, prepared: Awaited<ReturnType<typeof prepare>>, recordId: string, services: Catalog['services'], replace = false) {
  if (replace) await tx.update(records).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(records.tenantId, context.tenantId), eq(records.entityId, prepared.lines.id), sql`${records.customData}->>'cita'=${recordId}`, isNull(records.deletedAt)))
  for (const service of services) {
    const parsed = prepared.lineSchema.safeParse({ cita: recordId, servicio: service.id, importe: service.price })
    if (!parsed.success) throw createError({ statusCode: 422, statusMessage: 'No se pudo completar la reserva.' })
    await assertWritableRelations(tx, context.tenantId, prepared.lineFields, parsed.data)
    await tx.insert(records).values({ tenantId: context.tenantId, entityId: prepared.lines.id, customData: parsed.data })
  }
}
async function contactLock(tx: typeof db, tenant: string, email: string, phone: string) {
  for (const key of [email && `email:${email}`, phone && `phone:${phone}`].filter(Boolean).sort()) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${tenant + ':' + key},177))`)
}
async function activeContactLimit(tx: typeof db, context: PublicAgendaContext, email: string, phone: string, max: number, now: number) {
  const rows = await tx.select({ data: records.customData }).from(agendaPublicBookings).innerJoin(records, eq(records.id, agendaPublicBookings.recordId))
    .where(and(eq(agendaPublicBookings.tenantId, context.tenantId), eq(agendaPublicBookings.status, 'active'), isNull(records.deletedAt), sql`(${email ? agendaHash(email) : null} = ${agendaPublicBookings.clientEmailHash} or ${phone ? agendaHash(phone) : null} = ${agendaPublicBookings.clientPhoneHash})`))
  const { timezone } = await agendaSettingsInTx(tx, context.tenantId)
  const active = rows.filter(row => { const data = row.data as Record<string, unknown>; const start = localInstant(`${data.fecha}T${data.hora}`, timezone); return !['cancelada', 'no_asistio', 'terminada'].includes(String(data.estado)) && start !== null && start > now })
  if (active.length >= max) throw createError({ statusCode: 429, statusMessage: 'No se pudo completar la reserva. Intenta más tarde.' })
}
async function findOrCreateClient(tx: typeof db, context: PublicAgendaContext, catalog: Catalog, metadata: Awaited<ReturnType<typeof clientMetadata>>, schema: Awaited<ReturnType<typeof getEntityZodSchema>>, client: PublicBook['client']) {
  const fields = catalog.config.clientFields
  const email = client.email.toLowerCase(), phone = client.phone
  const matches = await tx.select({ id: records.id, data: records.customData }).from(records).where(and(eq(records.tenantId, context.tenantId), eq(records.entityId, metadata.entityId), isNull(records.deletedAt),
    sql`(${email || null} = lower(trim(${records.customData}->>${fields.email})) or ${phone || null} = regexp_replace(${records.customData}->>${fields.phone}, '[[:space:]()+.\-]', '', 'g'))`)).limit(3)
  if (matches.length === 1) {
    const candidate = matches[0]!, data = candidate.data as Record<string, unknown>
    if ((!email || String(data[fields.email] ?? '').trim().toLowerCase() === email) && (!phone || normalizeAgendaPhone(String(data[fields.phone] ?? '')) === phone)) return candidate.id
  }
  const mapped = Object.fromEntries(Object.entries(fields).map(([key, field]) => [field, client[key as keyof typeof client]]))
  if (!client.name && !catalog.config.requiredFields.includes('name')) mapped[fields.name] = 'Visitante del sitio'
  let customData = await defaultRecordValues(tx, context.tenantId, metadata.fields, mapped)
  for (const field of metadata.fields) if (field.dataType === 'incremental') customData[field.name] = await generateIncrementalValue(tx, context.tenantId, field, customData)
  customData = await applyCalculatedFields(tx, context.tenantId, metadata.entityId, customData, undefined, metadata.fields)
  const parsed = schema.safeParse(customData)
  if (!parsed.success) throw createError({ statusCode: 422, statusMessage: 'No se pudo completar la reserva.' })
  await assertWritableRelations(tx, context.tenantId, metadata.fields, parsed.data)
  const [created] = await tx.insert(records).values({ tenantId: context.tenantId, entityId: metadata.entityId, customData: parsed.data }).returning({ id: records.id })
  await recalculateCalculatedDependents(tx, context.tenantId, metadata.entityId, null, parsed.data)
  return created!.id
}
function escape(value: string) { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!)) }
export function publicAgendaEmail(confirmation: ReturnType<typeof publicConfirmation>, action: 'book' | 'cancel' | 'reschedule', link?: string) {
  const subject = action === 'cancel' ? 'Cita cancelada' : action === 'reschedule' ? 'Cita reprogramada' : 'Confirmación de cita'
  const text = `${confirmation.date} a las ${confirmation.time} (${confirmation.timezone}). ${confirmation.services.join(', ')}. Atiende: ${confirmation.personal}.`
  // Correo siempre claro; usa colores de sistema del cliente de correo.
  return { subject, html: `<div style="color:CanvasText;background:Canvas;color-scheme:light"><h1>${subject}</h1><p>${escape(text)}</p><p>${escape(confirmation.message)}</p>${link ? `<p><a href="${escape(link)}">Cancelar o reprogramar mi cita</a></p>` : ''}</div>` }
}
async function queueNotifications(tx: typeof db, prepared: Awaited<ReturnType<typeof prepare>>, context: PublicAgendaContext, catalog: Catalog, data: Record<string, unknown>, services: string[], clientEmail: string, action: 'book' | 'cancel' | 'reschedule', token?: string, previousPerson?: string) {
  const confirmation = publicConfirmation(catalog, context, data, services)
  const link = token ? `${agendaFlowOrigin()}/agenda-manage/${context.site}/${context.page}#agenda=${encodeURIComponent(token)}` : undefined
  const assigned = catalog.people.find(person => person.id === data.personal)
  const jobs: Awaited<ReturnType<typeof enqueueCriticalEmailInTx>>[] = []
  if (clientEmail) jobs.push(await enqueueCriticalEmailInTx(tx, context.tenantId, { to: clientEmail, ...publicAgendaEmail(confirmation, action, link) }, prepared.quota))
  if (assigned?.email) jobs.push(await enqueueCriticalEmailInTx(tx, context.tenantId, { to: assigned.email, ...publicAgendaEmail(confirmation, action) }, prepared.quota))
  const previous = catalog.people.find(person => person.id === previousPerson)
  if (previous?.email && previous.id !== assigned?.id) jobs.push(await enqueueCriticalEmailInTx(tx, context.tenantId, { to: previous.email, ...publicAgendaEmail(confirmation, action) }, prepared.quota))
  return { confirmation, jobs }
}
export async function publicAgendaBook(context: PublicAgendaContext, input: PublicBook, now = Date.now()) {
  if (input._flow_honeypot || !validAgendaFormToken(input.formToken, context.site, context.page, now)) throw createError({ statusCode: 422, statusMessage: 'No se pudo completar la reserva.' })
  const prepared = await withSystemRecordAccess(() => prepare(context))
  const token = newAgendaToken()
  await verifyAgendaTurnstile(context, prepared.catalog.config, 'book', input.turnstileToken, now)
  await expireAgendaConfirmations(context.tenantId, now)
  const confirmationToken = newAgendaToken()
  const result = await withSystemRecordAccess(() => withTenant(context.tenantId, async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${context.tenantId},175))`)
    const catalog = await catalogInTx(tx, context)
    for (const field of catalog.config.requiredFields) if (!input.client[field]) throw createError({ statusCode: 422, statusMessage: 'Revisa los datos de la reserva.' })
    if (catalog.config.botProtection !== prepared.catalog.config.botProtection || catalog.config.turnstileOutage !== prepared.catalog.config.turnstileOutage || catalog.config.confirmEmail !== prepared.catalog.config.confirmEmail) throw createError({ statusCode: 409, statusMessage: 'La agenda cambió. Intenta nuevamente.' })
    if ((!input.client.email && !input.client.phone) || (catalog.config.requireConsent && !input.consent)) throw createError({ statusCode: 422, statusMessage: 'Revisa los datos de la reserva.' })
    const services = selectServices(catalog, context, input.services), personal = selectPerson(catalog, context, input.personal)
    await contactLock(tx, context.tenantId, input.client.email, input.client.phone)
    await activeContactLimit(tx, context, input.client.email, input.client.phone, catalog.config.maxActiveBookings, now)
    const available = await availabilityFor(tx, context, catalog, input.date, input.date, services.map(service => service.id), personal, now)
    const selected = (personal ? available.slots : available.automatic).find(slot => slot.time === input.time)
    if (!selected) throw createError({ statusCode: 409, statusMessage: 'Este hueco ya no está disponible. Elige otro horario.' })
    const metadata = await clientMetadata(tx, context.tenantId, catalog.base.id, catalog.config)
    if (metadata.entityId !== prepared.client.entityId) throw createError({ statusCode: 409, statusMessage: 'La agenda cambió. Intenta nuevamente.' })
    const client = await findOrCreateClient(tx, context, catalog, metadata, prepared.clientSchema, input.client)
    const row = await reserveSlotInTx(tx, { tenantId: context.tenantId, userId: selected.userId, date: input.date, time: input.time, service: services.map(service => service.id).join(','), customData: { asunto: services.map(service => service.name).join(', ').slice(0, 160), cliente: client }, now }, catalog.base.id, prepared.schema)
    await writeServiceLines(tx, context, prepared, row.id, services)
    const pending = catalog.config.confirmEmail
    const confirmationExpiresAt = new Date(Math.min(now + catalog.config.confirmationMinutes * 60000, localInstant(`${input.date}T${input.time}`, catalog.timezone)!))
    if (pending) {
      if (!input.client.email) throw createError({ statusCode: 422, statusMessage: 'Revisa los datos de la reserva.' })
      const delivery = await tx.execute(sql`insert into agenda_security_buckets(tenant_id,key_hash,attempts,expires_at)
        values (${context.tenantId}::uuid,${agendaPrivateKey(`confirmation:${input.client.email}:${input.date}:${input.time}`)},1,${new Date(Math.max(now, localInstant(`${input.date}T${input.time}`, catalog.timezone)!) + 86400000).toISOString()}::timestamptz)
        on conflict(tenant_id,key_hash) do nothing returning key_hash`)
      if (!delivery.length) throw createError({ statusCode: 429, statusMessage: 'Demasiadas solicitudes. Intenta más tarde.' })
      const data = { ...row.customData as Record<string, unknown>, estado: 'por_confirmar' }
      await tx.update(records).set({ customData: data }).where(eq(records.id, row.id)); row.customData = data
    }
    await tx.insert(agendaPublicBookings).values({ tenantId: context.tenantId, siteId: context.site, pageId: context.page, recordId: row.id, tokenHash: agendaHash(token),
      confirmationHash: pending ? agendaHash(confirmationToken) : null, confirmationExpiresAt: pending ? confirmationExpiresAt : null, confirmationState: pending ? 'pending' : 'none',
      clientEmailHash: input.client.email ? agendaHash(input.client.email) : null, clientPhoneHash: input.client.phone ? agendaHash(input.client.phone) : null,
      serviceIds: services.map(service => service.id), expiresAt: new Date(localInstant(`${input.date}T${input.time}`, catalog.timezone)!), originHash: context.fingerprint, userAgent: context.userAgent })
    await tx.insert(recordActivities).values({ tenantId: context.tenantId, recordId: row.id, userId: selected.userId, actionType: 'PUBLIC_BOOKING', details: { source: 'Sitio web', siteId: context.site, pageId: context.page } })
    if (pending) {
      const confirmation = publicConfirmation(catalog, context, row.customData as Record<string, unknown>, services.map(service => service.id))
      const link = `${agendaFlowOrigin()}/agenda-manage/${context.site}/${context.page}#confirm=${confirmationToken}`
      const text = `Confirma tu cita del ${confirmation.date} a las ${confirmation.time} (${confirmation.timezone}) antes de ${Math.max(1, Math.ceil((confirmationExpiresAt.getTime() - now) / 60000))} minutos. Si no fuiste tú, ignora este mensaje. El horario se liberará automáticamente.\n${link}`
      if (prepared.quota.exceeded) throw createError({ statusCode: 422, statusMessage: 'No se pudo completar la reserva.' })
      const job = await enqueueCriticalEmailInTx(tx, context.tenantId, { to: input.client.email, subject: 'Confirma tu cita', text,
        html: `<div style="color:CanvasText;background:Canvas;color-scheme:light"><h1>Confirma tu cita</h1><p>${escape(text.split('\n')[0]!)}</p><p><a href="${escape(link)}">Confirmar mi cita</a></p></div>` }, prepared.quota)
      await tx.insert(jobQueue).values({ tenantId: context.tenantId, kind: 'agenda_expire', payload: { recordId: row.id }, runAt: confirmationExpiresAt, idempotencyKey: `agenda-expire:${row.id}` })
      return { confirmation: { ...confirmation, message: 'Revisa tu correo para confirmar la cita. El horario se guarda temporalmente.', pending: true }, jobs: [job], row, entityId: catalog.base.id, pending: true }
    }
    return { ...(await queueNotifications(tx, prepared, context, catalog, row.customData as Record<string, unknown>, services.map(service => service.id), input.client.email, 'book', token)), row, entityId: catalog.base.id }
  }))
  if (!('pending' in result)) fireTriggersForRecord(context.tenantId, result.entityId, 'on_create', result.row.id, result.row.customData as Record<string, unknown>)
  await Promise.all(result.jobs.map(job => sendQueuedCriticalEmail(context.tenantId, job.id, job.payload)))
  return { ...result.confirmation, token: 'pending' in result ? '' : token }
}
export async function publicAgendaConfirm(context: PublicAgendaContext, confirmationToken: string, now = Date.now()) {
  await expireAgendaConfirmations(context.tenantId, now)
  const prepared = await withSystemRecordAccess(() => prepare(context)), token = newAgendaToken()
  const result = await withSystemRecordAccess(() => withTenant(context.tenantId, async tx => {
    const [booking] = await tx.select().from(agendaPublicBookings).where(and(eq(agendaPublicBookings.tenantId, context.tenantId), eq(agendaPublicBookings.siteId, context.site), eq(agendaPublicBookings.pageId, context.page), eq(agendaPublicBookings.confirmationHash, agendaHash(confirmationToken)))).for('update')
    if (!booking) throw publicAgendaNotFound()
    if (booking.confirmationState === 'expired' || booking.confirmationState === 'pending' && (!booking.confirmationExpiresAt || booking.confirmationExpiresAt.getTime() <= now)) throw createError({ statusCode: 410, statusMessage: 'El enlace venció. El horario ya fue liberado.' })
    if (booking.confirmationState === 'confirmed') return { alreadyConfirmed: true as const }
    if (booking.confirmationState !== 'pending' || booking.status !== 'active') throw publicAgendaNotFound()
    const [record] = await tx.select().from(records).where(and(eq(records.id, booking.recordId), eq(records.tenantId, context.tenantId), isNull(records.deletedAt))).for('update')
    if (!record || (record.customData as Record<string, unknown>).estado !== 'por_confirmar') throw publicAgendaNotFound()
    const catalog = await catalogInTx(tx, context)
    const data: Record<string, unknown> = { ...record.customData as Record<string, unknown>, estado: 'agendada' }
    await tx.update(records).set({ customData: data, updatedAt: new Date(now), isDirty: true }).where(eq(records.id, record.id))
    await tx.update(agendaPublicBookings).set({ confirmationState: 'confirmed', tokenHash: agendaHash(token) }).where(eq(agendaPublicBookings.id, booking.id))
    const metadata = await clientMetadata(tx, context.tenantId, catalog.base.id, catalog.config)
    const [client] = await tx.select({ data: records.customData }).from(records).where(and(eq(records.id, String(data.cliente)), eq(records.tenantId, context.tenantId), eq(records.entityId, metadata.entityId), isNull(records.deletedAt)))
    const email = String((client?.data as Record<string, unknown> | undefined)?.[catalog.config.clientFields.email] ?? '')
    return { ...(await queueNotifications(tx, prepared, context, catalog, data, booking.serviceIds, email, 'book', token)), data, id: record.id, entity: record.entityId }
  }))
  if ('alreadyConfirmed' in result) return result
  fireTriggersForRecord(context.tenantId, result.entity, 'on_create', result.id, result.data)
  await Promise.all(result.jobs.map(job => sendQueuedCriticalEmail(context.tenantId, job.id, job.payload)))
  return { ...result.confirmation, token }
}
async function bookingInTx(tx: typeof db, context: PublicAgendaContext, token: string, now: number, lock = false) {
  const hash = agendaHash(token)
  if (lock) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${context.tenantId + ':' + hash},177))`)
  const [booking] = await tx.select().from(agendaPublicBookings).where(and(eq(agendaPublicBookings.tenantId, context.tenantId), eq(agendaPublicBookings.siteId, context.site), eq(agendaPublicBookings.pageId, context.page), eq(agendaPublicBookings.tokenHash, hash), eq(agendaPublicBookings.status, 'active'), gt(agendaPublicBookings.expiresAt, new Date(now)))).limit(1)
  if (!booking) throw publicAgendaNotFound()
  const query = tx.select().from(records).where(and(eq(records.id, booking.recordId), eq(records.tenantId, context.tenantId), isNull(records.deletedAt))).limit(1)
  const [record] = await (lock ? query.for('update') : query)
  if (!record || !['agendada', 'confirmada'].includes(String((record.customData as Record<string, unknown>).estado))) throw publicAgendaNotFound()
  return { booking, record, data: record.customData as Record<string, unknown> }
}
export async function publicAgendaBooking(context: PublicAgendaContext, token: string, now = Date.now()) {
  return withSystemRecordAccess(() => withTenant(context.tenantId, async tx => {
    const catalog = await catalogInTx(tx, context), result = await bookingInTx(tx, context, token, now)
    const { message, ...confirmation } = publicConfirmation(catalog, context, result.data, result.booking.serviceIds)
    return confirmation
  }))
}
export async function publicAgendaManage(context: PublicAgendaContext, token: string, replacement?: PublicReschedule, now = Date.now(), turnstileToken?: string) {
  const prepared = await withSystemRecordAccess(() => prepare(context))
  await verifyAgendaTurnstile(context, prepared.catalog.config, replacement ? 'reschedule' : 'cancel', replacement?.turnstileToken ?? turnstileToken, now)
  const newToken = replacement ? newAgendaToken() : undefined
  const result = await withSystemRecordAccess(() => withTenant(context.tenantId, async tx => {
    const catalog = await catalogInTx(tx, context)
    const old = await bookingInTx(tx, context, token, now, true)
    if (!canManageAgenda(localInstant(`${old.data.fecha}T${old.data.hora}`, catalog.timezone), catalog.config.cancellationHours, now)) throw createError({ statusCode: 409, statusMessage: 'Ya no es posible cambiar esta cita.' })
    const metadata = await clientMetadata(tx, context.tenantId, catalog.base.id, catalog.config)
    const [client] = await tx.select({ data: records.customData }).from(records).where(and(eq(records.id, String(old.data.cliente)), eq(records.tenantId, context.tenantId), eq(records.entityId, metadata.entityId), isNull(records.deletedAt))).limit(1)
    const email = String((client?.data as Record<string, unknown> | undefined)?.[catalog.config.clientFields.email] ?? '')
    await contactLock(tx, context.tenantId, old.booking.clientEmailHash ?? '', old.booking.clientPhoneHash ?? '')
    // Cancelación provisional en la misma transacción; cualquier fallo restaura
    // la cita original, el token y su ocupación, sin dejar otra cita.
    await tx.update(records).set({ customData: { ...old.data, estado: 'cancelada' }, updatedAt: new Date(), isDirty: true }).where(eq(records.id, old.record.id))
    let data: Record<string, unknown> = { ...old.data, estado: 'cancelada' }
    let serviceIds = old.booking.serviceIds
    if (replacement) {
      const services = selectServices(catalog, context, replacement.services), person = selectPerson(catalog, context, replacement.personal)
      const available = await availabilityFor(tx, context, catalog, replacement.date, replacement.date, services.map(service => service.id), person, now)
      const selected = (person ? available.slots : available.automatic).find(slot => slot.time === replacement.time)
      if (!selected) throw createError({ statusCode: 409, statusMessage: 'Este hueco ya no está disponible. Elige otro horario.' })
      const row = await reserveSlotInTx(tx, { tenantId: context.tenantId, userId: selected.userId, date: replacement.date, time: replacement.time, service: services.map(service => service.id).join(','), customData: old.data, now }, catalog.base.id, prepared.schema, old.record.id)
      data = row.customData as typeof data; serviceIds = services.map(service => service.id)
      await writeServiceLines(tx, context, prepared, old.record.id, services, true)
      await tx.update(agendaPublicBookings).set({ tokenHash: agendaHash(newToken!), serviceIds, rescheduleCount: old.booking.rescheduleCount + 1, expiresAt: new Date(localInstant(`${replacement.date}T${replacement.time}`, catalog.timezone)!) }).where(eq(agendaPublicBookings.id, old.booking.id))
    } else await tx.update(agendaPublicBookings).set({ status: 'canceled', canceledAt: new Date(now) }).where(eq(agendaPublicBookings.id, old.booking.id))
    await tx.insert(recordActivities).values({ tenantId: context.tenantId, recordId: old.record.id, userId: String(data.personal), actionType: replacement ? 'PUBLIC_RESCHEDULE' : 'PUBLIC_CANCEL', details: { source: 'Sitio web', previous: { date: old.data.fecha, time: old.data.hora, personal: old.data.personal }, next: { date: data.fecha, time: data.hora, personal: data.personal } } })
    return { ...(await queueNotifications(tx, prepared, context, catalog, data, serviceIds, email, replacement ? 'reschedule' : 'cancel', newToken, String(old.data.personal))), data, recordId: old.record.id, entityId: catalog.base.id }
  }))
  fireTriggersForRecord(context.tenantId, result.entityId, 'on_update', result.recordId, result.data)
  await Promise.all(result.jobs.map(job => sendQueuedCriticalEmail(context.tenantId, job.id, job.payload)))
  return { ...result.confirmation, ...(newToken ? { token: newToken } : {}) }
}

export async function agendaSiteAdministration(auth: AuthTokenPayload, site: string, input?: unknown) {
  const config = input === undefined ? undefined : agendaSiteSettingsSchema.parse(input)
  return withTenant(auth.tenantId, async tx => {
    if (!(await agendaActor(tx, auth, null)).manage) throw createError({ statusCode: 403, statusMessage: 'No tienes permiso para administrar esta agenda.' })
    const [owner] = await tx.select({ id: sites.id }).from(sites).where(and(eq(sites.id, site), eq(sites.tenantId, auth.tenantId))).limit(1)
    if (!owner) throw publicAgendaNotFound()
    const base = await agendaBaseInTx(tx, auth.tenantId)
    const staff = await agendaStaff(tx, auth.tenantId)
    const hasSchedules = staff.some(person => person.scheduled)
    if (config) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${auth.tenantId},175))`)
      if (config.enabled && (!base || !hasSchedules)) throw createError({ statusCode: 422, statusMessage: !base ? 'Instala Citas base para activar la agenda.' : 'Configura horarios para activar la agenda.' })
      const services = await tx.select({ id: records.id }).from(records).innerJoin(entities, eq(entities.id, records.entityId)).where(and(eq(records.tenantId, auth.tenantId), eq(entities.tenantId, auth.tenantId), eq(entities.slug, 'agenda-servicios'), eq(entities.templateKey, 'agenda'), isNull(records.deletedAt), isNull(entities.deletedAt)))
      if (config.personalIds.some(id => !staff.some(person => person.id === id)) || config.serviceIds.some(id => !services.some(service => service.id === id))) throw createError({ statusCode: 422, statusMessage: 'Selecciona servicios y personal de esta organización.' })
      if (config.enabled && base) await clientMetadata(tx, auth.tenantId, base.id, config)
      if (config.botProtection === 'disabled' && process.env.TURNSTILE_ALLOW_DISABLED !== 'true') throw createError({ statusCode: 422, statusMessage: 'La plataforma no permite desactivar la protección contra bots.' })
      if (config.confirmEmail && base) {
        const [field] = await tx.select().from(entityFields).where(and(eq(entityFields.entityId, base.id), eq(entityFields.name, 'estado'))).for('update')
        const rules = (field?.validationRules ?? {}) as { options?: Array<{ value: string; label: string }> }
        if (field && !rules.options?.some(option => option.value === 'por_confirmar')) await tx.update(entityFields).set({ validationRules: { ...rules, options: [...rules.options ?? [], { value: 'por_confirmar', label: 'Por confirmar' }] } }).where(eq(entityFields.id, field.id))
        const workflow = stateWorkflowSchema.safeParse(base.workflowConfig)
        if (workflow.success && workflow.data.field === 'estado' && !workflow.data.states.por_confirmar) await tx.update(entities).set({ workflowConfig: { ...workflow.data, states: { ...workflow.data.states, por_confirmar: { locked: true, editableFields: [] } } } }).where(eq(entities.id, base.id))
      }
      await tx.insert(agendaSiteSettings).values({ tenantId: auth.tenantId, siteId: site, config }).onConflictDoUpdate({ target: agendaSiteSettings.siteId, set: { config, updatedAt: new Date() } })
    }
    const [saved] = await tx.select({ config: agendaSiteSettings.config }).from(agendaSiteSettings).where(eq(agendaSiteSettings.siteId, site)).limit(1)
    const recent = await tx.select({ id: agendaPublicBookings.id, recordId: agendaPublicBookings.recordId, status: agendaPublicBookings.status, createdAt: agendaPublicBookings.createdAt, rescheduleCount: agendaPublicBookings.rescheduleCount,
      date: sql<string>`${records.customData}->>'fecha'`, time: sql<string>`${records.customData}->>'hora'`, personal: sql<string>`${records.customData}->>'personal'`, services: agendaPublicBookings.serviceIds }).from(agendaPublicBookings)
      .innerJoin(records, and(eq(records.id, agendaPublicBookings.recordId), eq(records.tenantId, agendaPublicBookings.tenantId)))
      .where(and(eq(agendaPublicBookings.tenantId, auth.tenantId), eq(agendaPublicBookings.siteId, site))).orderBy(desc(agendaPublicBookings.createdAt)).limit(50)
    const catalogPeople = staff
    const catalogServices = await tx.select({ id: records.id, data: records.customData }).from(records).innerJoin(entities, eq(entities.id, records.entityId))
      .where(and(eq(records.tenantId, auth.tenantId), eq(entities.tenantId, auth.tenantId), eq(entities.slug, 'agenda-servicios'), eq(entities.templateKey, 'agenda'), eq(entities.isActive, true), isNull(entities.deletedAt), isNull(records.deletedAt)))
    const own = staff.find(person => person.id === auth.sub)
    return { settings: agendaSiteSettingsSchema.parse(saved?.config ?? {}), botProtectionCanDisable: process.env.TURNSTILE_ALLOW_DISABLED === 'true', available: !!base && hasSchedules, ownStaff: own ? { id: own.id, administrator: own.isSystem === true, scheduled: own.scheduled } : null, scheduledOtherRoles: staff.filter(person => person.scheduled && person.roleName !== 'Personal' && !person.isSystem).map(person => person.name || person.email), reason: !base ? 'Instala Citas base.' : !hasSchedules ? 'Configura horarios del personal.' : null, recent,
      services: catalogServices.map(s => ({ id: s.id, name: String((s.data as Record<string, unknown>).nombre ?? ''), duration: Number((s.data as Record<string, unknown>).duracion_minutos) })).filter(s => s.name && s.duration > 0),
      people: catalogPeople.filter(p => p.name?.trim()).map(p => ({ id: p.id, name: p.name!, scheduled: p.scheduled })) }
  })
}
