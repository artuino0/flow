import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db, withTenant } from '~/server/db'
import { agendaSchedules, agendaTimeOff, entities, entityFields, records, recordActivities } from '~/server/db/schema'
import { agendaPeople, agendaSettingsInTx, requireAgendaBase } from './agendaAdmin'
import { calculateAvailability, localInstant, localAt, addAgendaDays } from './agendaEngine'
import { agendaDate, agendaTime, type AgendaAppointment } from '~/utils/agenda'
import { z } from 'zod'
import { currentRecordActor, withSystemRecordAccess } from './recordActorContext'
import { getEntityZodSchema } from './dynamicSchema'
import { assertWritableRelations } from './relationWriteGuard'
import { fireTriggersForRecord } from './triggers'
import { applyFieldDefaults } from './fieldValidations/registry'

export const availabilityQuery = z.object({ personal: z.string().uuid().optional(), service: z.string().optional(), from: agendaDate, to: agendaDate,
  duration: z.coerce.number().int().min(1).max(1440).optional()
}).refine(v => v.from <= v.to && Date.parse(v.to) - Date.parse(v.from) <= 365 * 86400000, 'La consulta admite hasta 365 días')
export type AvailabilityQuery = z.infer<typeof availabilityQuery>
export async function serviceDuration(tx: typeof db, tenantId: string, service: string | undefined, fallback?: number) {
  if (!service) return fallback ?? 30
  const ids = service.split(',')
  if (ids.length > 30 || ids.some(id => !z.string().uuid().safeParse(id).success)) throw createError({ statusCode: 422, statusMessage: 'Selecciona servicios válidos.' })
  const [entity] = await tx.select({ id: entities.id }).from(entities).where(and(eq(entities.tenantId, tenantId), eq(entities.slug, 'agenda-servicios'), eq(entities.templateKey, 'agenda'), isNull(entities.deletedAt))).limit(1)
  if (!entity) throw createError({ statusCode: 422, statusMessage: 'No existe el módulo de Servicios de Agenda.' })
  const rows = await tx.select({ id: records.id, data: records.customData }).from(records).where(and(eq(records.tenantId, tenantId), eq(records.entityId, entity.id), inArray(records.id, ids), isNull(records.deletedAt)))
  const duration = ids.reduce((sum, id) => sum + Number((rows.find(row => row.id === id)?.data as { duracion_minutos?: number } | undefined)?.duracion_minutos ?? NaN), 0)
  if (!Number.isInteger(duration) || duration < 1 || duration > 1440) throw createError({ statusCode: 422, statusMessage: 'Los servicios deben tener duración positiva; la suma no debe superar 1440 minutos.' })
  return duration
}
export async function availabilityInTx(tx: typeof db, tenantId: string, query: AvailabilityQuery, now = Date.now(), publicOptions?: { people: { id: string; name: string }[]; assignmentMode: 'client_chooses' | 'auto' | 'both' }) {
  await requireAgendaBase(tx, tenantId)
  const { settings, timezone } = await agendaSettingsInTx(tx, tenantId)
  const people = publicOptions?.people ?? await agendaPeople(tx, tenantId)
  if (publicOptions) settings.assignmentMode = publicOptions.assignmentMode
  if (query.personal && !people.some(p => p.id === query.personal)) throw createError({ statusCode: 404, statusMessage: 'Personal no encontrado.' })
  const schedules = await tx.select().from(agendaSchedules).where(eq(agendaSchedules.tenantId, tenantId))
  const timeOff = await tx.select().from(agendaTimeOff).where(eq(agendaTimeOff.tenantId, tenantId))
  const occupied = await tx.execute(sql`select * from agenda_occupancy(${tenantId}::uuid) where fecha >= ${addAgendaDays(query.from, -2)} and fecha <= ${addAgendaDays(query.to, 1)}`)
  const appointments: AgendaAppointment[] = occupied.map(row => ({ userId: String(row.user_id), date: String(row.fecha), time: String(row.hora), duration: Number(row.duration), state: String(row.estado) }))
  const duration = await serviceDuration(tx, tenantId, query.service, query.duration)
  return { ...calculateAvailability({ settings, timezone, people: query.personal ? people.filter(p => p.id === query.personal) : people,
    schedules: schedules.map(row => ({ ...row, startTime: row.startTime.slice(0, 5), endTime: row.endTime.slice(0, 5) })),
    timeOff: timeOff.map(row => ({ ...row, startLocal: row.startLocal.replace(' ', 'T').slice(0, 16), endLocal: row.endLocal.replace(' ', 'T').slice(0, 16) })),
    appointments, from: query.from, to: query.to, duration, now }), timezone, duration, assignmentMode: settings.assignmentMode }
}
export function getAgendaAvailability(tenantId: string, query: AvailabilityQuery) {
  return withSystemRecordAccess(() => withTenant(tenantId, tx => availabilityInTx(tx, tenantId, query)))
}
export interface ReserveSlotInput { tenantId: string; userId: string; date: string; time: string; duration?: number; service?: string; customData: Record<string, unknown>; now?: number }
export async function reserveSlotInTx(tx: typeof db, input: ReserveSlotInput, baseId: string, schema: Awaited<ReturnType<typeof getEntityZodSchema>>, recordId?: string) {
  const date = agendaDate.parse(input.date), time = agendaTime.parse(input.time)
    await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${input.tenantId},175))`)
    const { settings, timezone } = await agendaSettingsInTx(tx, input.tenantId)
    const duration = await serviceDuration(tx, input.tenantId, input.service, input.duration)
    const start = localInstant(`${date}T${time}`, timezone)
    if (start === null) throw createError({ statusCode: 422, statusMessage: 'Esta hora no existe en la zona horaria de la organización.' })
    const lockStart = localAt(start - settings.bufferMinutes * 60000, timezone), lockEnd = localAt(start + (duration + settings.bufferMinutes) * 60000, timezone)
    await tx.execute(sql`select agenda_lock_slot(${input.tenantId}::uuid,${input.userId}::uuid,${lockStart}::timestamp,${lockEnd}::timestamp)`)
    const available = await availabilityInTx(tx, input.tenantId, { personal: input.userId, from: date, to: date, duration }, input.now)
    if (![...available.slots, ...available.automatic].some(slot => slot.time === time)) throw createError({ statusCode: 409, statusMessage: 'Hueco ya ocupado o fuera del horario disponible.' })
    const fields = await tx.select({ name: entityFields.name, dataType: entityFields.dataType, validationRules: entityFields.validationRules }).from(entityFields).where(eq(entityFields.entityId, baseId))
    const values = applyFieldDefaults(fields, { ...input.customData, fecha: date, hora: time, personal: input.userId, duracion_minutos: duration, estado: 'agendada' }, { userId: input.userId, timezone })
    const parsed = schema.safeParse(values)
    if (!parsed.success) throw createError({ statusCode: 422, statusMessage: 'Datos de cita inválidos.', data: parsed.error.flatten() })
    await assertWritableRelations(tx, input.tenantId, fields, parsed.data)
    const [created] = recordId
      ? await tx.update(records).set({ customData: parsed.data, updatedAt: new Date(), isDirty: true }).where(and(eq(records.id, recordId), eq(records.tenantId, input.tenantId), eq(records.entityId, baseId))).returning()
      : await tx.insert(records).values({ tenantId: input.tenantId, entityId: baseId, customData: parsed.data }).returning()
    if (!created) throw createError({ statusCode: 404, statusMessage: 'Cita no disponible.' })
    await tx.insert(recordActivities).values({ tenantId: input.tenantId, recordId: created.id, userId: currentRecordActor()?.userId ?? input.userId, actionType: recordId ? 'UPDATED' : 'CREATED', details: { source: 'agenda', customData: parsed.data } })
    return created!
}
export async function reserveSlot(input: ReserveSlotInput) {
  const base = await withTenant(input.tenantId, tx => requireAgendaBase(tx, input.tenantId))
  const schema = await getEntityZodSchema(input.tenantId, base.id, { userId: input.userId })
  const row = await withTenant(input.tenantId, tx => reserveSlotInTx(tx, input, base.id, schema))
  fireTriggersForRecord(input.tenantId, base.id, 'on_create', row.id, row.customData as Record<string, unknown>)
  return row
}
