import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db, withTenant } from '~/server/db'
import { agendaPublicBookings, agendaSchedules, agendaSiteSettings, entities, entityFields, people, records, recordActivities, roles, sitePages, sites, users } from '~/server/db/schema'
import { agendaSiteSettingsSchema, normalizeAgendaPhone, type AgendaSiteConfig, type PublicBook, type PublicReschedule } from '~/utils/agendaPublic'
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

export interface PublicAgendaOrigin { origin: string; host: string; ip: string; userAgent: string }
// Origen de Flow explícito; no confiar en X-Forwarded-Host ni en el cuerpo.
export function agendaFlowOrigin() {
  const deployed = process.env.NODE_ENV === 'production' || process.env.RAILWAY_PROJECT_ID || process.env.VERCEL
  const url = new URL(process.env.APP_BASE_URL || (deployed ? getPublicAppBaseUrl() : 'http://localhost:3000'))
  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) throw publicAgendaNotFound()
  return url.origin
}
function verifiedOrigin(input: PublicAgendaOrigin) {
  let url: URL
  try { url = new URL(input.origin) } catch { throw publicAgendaNotFound() }
  if (!['http:', 'https:'].includes(url.protocol) || url.host.toLowerCase() !== input.host.toLowerCase() || url.origin !== input.origin) throw publicAgendaNotFound()
  return { hostname: url.hostname.toLowerCase(), flow: url.origin === agendaFlowOrigin(), origin: url.origin }
}
export async function resolveAgendaContext(site: string, page: string, origin: PublicAgendaOrigin) {
  const verified = verifiedOrigin(origin)
  const rows = await db.execute(sql`select * from resolve_public_agenda(${site}::uuid,${page}::uuid,${verified.hostname},${verified.flow})`)
  const tenantId = rows[0]?.tenant_id
  if (!tenantId) throw publicAgendaNotFound()
  return { tenantId: String(tenantId), site, page, origin: verified.origin, fingerprint: agendaHash(`${String(tenantId)}:${origin.ip}`), userAgent: origin.userAgent.slice(0, 300) }
}
export type PublicAgendaContext = Awaited<ReturnType<typeof resolveAgendaContext>>
async function catalogInTx(tx: typeof db, context: PublicAgendaContext) {
  const { tenantId, site, page } = context
  const [published] = await tx.select({ id: sites.id }).from(sites).innerJoin(sitePages, and(eq(sitePages.siteId, sites.id), eq(sitePages.tenantId, sites.tenantId)))
    .where(and(eq(sites.id, site), eq(sites.tenantId, tenantId), eq(sites.status, 'published'), eq(sitePages.id, page), eq(sitePages.status, 'published'), sql`${sitePages.publishedVersionId} is not null`)).limit(1)
  const [setting] = await tx.select().from(agendaSiteSettings).where(and(eq(agendaSiteSettings.siteId, site), eq(agendaSiteSettings.tenantId, tenantId))).limit(1)
  if (!published || !setting) throw publicAgendaNotFound()
  const config = agendaSiteSettingsSchema.parse(setting.config)
  if (!config.enabled) throw publicAgendaNotFound()
  const base = await agendaBaseInTx(tx, tenantId)
  if (!base) throw publicAgendaNotFound()
  const staff = await tx.select({ id: users.id, name: people.fullName, email: people.email }).from(users)
    .innerJoin(roles, and(eq(roles.id, users.roleId), eq(roles.tenantId, users.tenantId))).innerJoin(people, eq(people.id, users.personId))
    .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true), eq(roles.name, 'Personal'))).orderBy(people.fullName, users.id)
  const visible = staff.filter(person => (!config.personalIds.length || config.personalIds.includes(person.id)) && person.name?.trim())
  const scheduled = await tx.select({ userId: agendaSchedules.userId }).from(agendaSchedules).where(eq(agendaSchedules.tenantId, tenantId))
  if (!visible.some(person => scheduled.some(row => row.userId === person.id))) throw publicAgendaNotFound()
  const services = await tx.select({ id: records.id, data: records.customData }).from(records).innerJoin(entities, eq(entities.id, records.entityId))
    .where(and(eq(records.tenantId, tenantId), eq(entities.tenantId, tenantId), eq(entities.slug, 'agenda-servicios'), eq(entities.templateKey, 'agenda'), eq(entities.isActive, true), isNull(entities.deletedAt), isNull(records.deletedAt)))
  const publicServices = services.filter(service => !config.serviceIds.length || config.serviceIds.includes(service.id)).map(service => {
    const data = service.data as Record<string, unknown>
    return { id: service.id, name: String(data.nombre ?? '').slice(0, 160), duration: Number(data.duracion_minutos), price: String(data.precio ?? '0') }
  }).filter(service => service.name && Number.isInteger(service.duration) && service.duration > 0 && service.duration <= 1440)
  if (!publicServices.length) throw publicAgendaNotFound()
  const { settings, timezone } = await agendaSettingsInTx(tx, tenantId)
  return { config, base, people: visible.map(person => ({ ...person, name: person.name! })), services: publicServices, mode: config.assignmentMode ?? settings.assignmentMode, settings, timezone }
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
  const link = token ? `${agendaFlowOrigin()}/site-preview/${context.site}/#agenda=${encodeURIComponent(token)}&page=${context.page}` : undefined
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
  const result = await withSystemRecordAccess(() => withTenant(context.tenantId, async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${context.tenantId},175))`)
    const catalog = await catalogInTx(tx, context)
    for (const field of catalog.config.requiredFields) if (!input.client[field]) throw createError({ statusCode: 422, statusMessage: 'Revisa los datos de la reserva.' })
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
    await tx.insert(agendaPublicBookings).values({ tenantId: context.tenantId, siteId: context.site, pageId: context.page, recordId: row.id, tokenHash: agendaHash(token),
      clientEmailHash: input.client.email ? agendaHash(input.client.email) : null, clientPhoneHash: input.client.phone ? agendaHash(input.client.phone) : null,
      serviceIds: services.map(service => service.id), expiresAt: new Date(localInstant(`${input.date}T${input.time}`, catalog.timezone)!), originHash: context.fingerprint, userAgent: context.userAgent })
    await tx.insert(recordActivities).values({ tenantId: context.tenantId, recordId: row.id, userId: selected.userId, actionType: 'PUBLIC_BOOKING', details: { source: 'Sitio web', siteId: context.site, pageId: context.page } })
    return { ...(await queueNotifications(tx, prepared, context, catalog, row.customData as Record<string, unknown>, services.map(service => service.id), input.client.email, 'book', token)), row, entityId: catalog.base.id }
  }))
  fireTriggersForRecord(context.tenantId, result.entityId, 'on_create', result.row.id, result.row.customData as Record<string, unknown>)
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
export async function publicAgendaManage(context: PublicAgendaContext, token: string, replacement?: PublicReschedule, now = Date.now()) {
  const prepared = await withSystemRecordAccess(() => prepare(context))
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
    const schedules = await tx.select({ id: agendaSchedules.id }).from(agendaSchedules).where(eq(agendaSchedules.tenantId, auth.tenantId)).limit(1)
    if (config) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${auth.tenantId},175))`)
      if (config.enabled && (!base || !schedules.length)) throw createError({ statusCode: 422, statusMessage: !base ? 'Instala Citas base para activar la agenda.' : 'Configura horarios para activar la agenda.' })
      const staff = await tx.select({ id: users.id }).from(users).innerJoin(roles, and(eq(roles.id, users.roleId), eq(roles.tenantId, users.tenantId))).where(and(eq(users.tenantId, auth.tenantId), eq(users.isActive, true), eq(roles.name, 'Personal')))
      const services = await tx.select({ id: records.id }).from(records).innerJoin(entities, eq(entities.id, records.entityId)).where(and(eq(records.tenantId, auth.tenantId), eq(entities.tenantId, auth.tenantId), eq(entities.slug, 'agenda-servicios'), eq(entities.templateKey, 'agenda'), isNull(records.deletedAt), isNull(entities.deletedAt)))
      if (config.personalIds.some(id => !staff.some(person => person.id === id)) || config.serviceIds.some(id => !services.some(service => service.id === id))) throw createError({ statusCode: 422, statusMessage: 'Selecciona servicios y personal de esta organización.' })
      if (config.enabled && base) await clientMetadata(tx, auth.tenantId, base.id, config)
      await tx.insert(agendaSiteSettings).values({ tenantId: auth.tenantId, siteId: site, config }).onConflictDoUpdate({ target: agendaSiteSettings.siteId, set: { config, updatedAt: new Date() } })
    }
    const [saved] = await tx.select({ config: agendaSiteSettings.config }).from(agendaSiteSettings).where(eq(agendaSiteSettings.siteId, site)).limit(1)
    const recent = await tx.select({ id: agendaPublicBookings.id, recordId: agendaPublicBookings.recordId, status: agendaPublicBookings.status, createdAt: agendaPublicBookings.createdAt, rescheduleCount: agendaPublicBookings.rescheduleCount,
      date: sql<string>`${records.customData}->>'fecha'`, time: sql<string>`${records.customData}->>'hora'`, personal: sql<string>`${records.customData}->>'personal'`, services: agendaPublicBookings.serviceIds }).from(agendaPublicBookings)
      .innerJoin(records, and(eq(records.id, agendaPublicBookings.recordId), eq(records.tenantId, agendaPublicBookings.tenantId)))
      .where(and(eq(agendaPublicBookings.tenantId, auth.tenantId), eq(agendaPublicBookings.siteId, site))).orderBy(desc(agendaPublicBookings.createdAt)).limit(50)
    return { settings: agendaSiteSettingsSchema.parse(saved?.config ?? {}), available: !!base && !!schedules.length, reason: !base ? 'Instala Citas base.' : !schedules.length ? 'Configura horarios del personal.' : null, recent }
  })
}
