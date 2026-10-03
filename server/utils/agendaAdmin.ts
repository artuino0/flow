import { and, eq, isNull, sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { H3Event } from 'h3'
import { requireAuth } from './rbac'
import { db, withTenant } from '~/server/db'
import { agendaSchedules, agendaSettings, agendaTimeOff, entities, people, roles, tenants, users } from '~/server/db/schema'
import { agendaDefaults, agendaSettingsSchema, schedulesSchema, timeOffSchema, type AgendaPerson } from '~/utils/agenda'
import type { AuthTokenPayload } from '~/server/utils/auth'

export function agendaPermissions(actor: { id: string; role: string; isSystem: boolean }, target: string | null) {
  const admin = actor.isSystem
  const reception = actor.role === 'Recepción'
  return { manage: admin || reception, edit: admin || reception || (actor.role === 'Personal' && target === actor.id), force: admin }
}
export function requireAgendaSession(event: H3Event) {
  const auth = requireAuth(event)
  if (event.context.apiKeyId) throw createError({ statusCode: 403, statusMessage: 'La administración de agenda requiere una sesión de usuario.' })
  return auth
}
export async function agendaActor(tx: typeof db, auth: AuthTokenPayload, target: string | null) {
  const [actor] = await tx.select({ id: users.id, role: roles.name, isSystem: roles.isSystem }).from(users)
    .innerJoin(roles, and(eq(roles.id, users.roleId), eq(roles.tenantId, users.tenantId)))
    .where(and(eq(users.id, auth.sub), eq(users.tenantId, auth.tenantId), eq(users.roleId, auth.roleId!), eq(users.isActive, true))).limit(1)
  if (!actor) throw createError({ statusCode: 403, statusMessage: 'No tienes acceso a la agenda de esta organización.' })
  return agendaPermissions(actor, target)
}
export async function agendaBaseInTx(tx: typeof db, tenantId: string) {
  const [base] = await tx.select().from(entities).where(and(eq(entities.tenantId, tenantId), eq(entities.slug, 'agenda-citas'), eq(entities.templateKey, 'agenda'), eq(entities.isActive, true), isNull(entities.deletedAt))).limit(1)
  return base ?? null
}
export async function requireAgendaBase(tx: typeof db, tenantId: string) {
  const base = await agendaBaseInTx(tx, tenantId)
  if (!base) throw createError({ statusCode: 422, statusMessage: 'Instala Citas base desde Módulos → Nuevo módulo → Citas prearmadas.' })
  return base
}
export async function agendaPerson(tx: typeof db, tenantId: string, userId: string) {
  const [person] = await tx.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, userId), eq(users.isActive, true))).limit(1)
  if (!person) throw createError({ statusCode: 404, statusMessage: 'Usuario no encontrado en esta organización.' })
  return person
}
export async function agendaPeople(tx: typeof db, tenantId: string): Promise<AgendaPerson[]> {
  return tx.select({ id: users.id, name: sql<string>`coalesce(${people.fullName},${people.email})` }).from(users)
    .innerJoin(people, eq(people.id, users.personId)).where(and(eq(users.tenantId, tenantId), eq(users.isActive, true))).orderBy(people.fullName, users.id)
}
export async function agendaSettingsInTx(tx: typeof db, tenantId: string) {
  const [settings] = await tx.select().from(agendaSettings).where(eq(agendaSettings.tenantId, tenantId)).limit(1)
  const [tenant] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  return { settings: settings ? agendaSettingsSchema.parse({ slotMinutes: settings.slotMinutes, bufferMinutes: settings.bufferMinutes, minNoticeMinutes: settings.minNoticeMinutes, maxDaysAhead: settings.maxDaysAhead, assignmentMode: settings.assignmentMode, conflictPolicy: settings.conflictPolicy, confirmationMessage: settings.confirmationMessage }) : { ...agendaDefaults }, timezone: tenant?.timezone ?? 'America/Mexico_City' }
}
export async function agendaMutationLock(tx: typeof db, tenantId: string) { await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${tenantId},175))`) }
export async function initializeAgenda(tenantId: string) {
  return withTenant(tenantId, async tx => {
    await agendaMutationLock(tx, tenantId)
    await tx.insert(agendaSettings).values({ tenantId }).onConflictDoNothing()
    const staff = await tx.select({ id: users.id }).from(users).innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.tenantId, tenantId), eq(roles.tenantId, tenantId), eq(roles.name, 'Personal'), eq(users.isActive, true)))
    for (const person of staff) {
      const existing = await tx.select({ id: agendaSchedules.id }).from(agendaSchedules).where(and(eq(agendaSchedules.tenantId, tenantId), eq(agendaSchedules.userId, person.id))).limit(1)
      if (!existing.length) await tx.insert(agendaSchedules).values([1, 2, 3, 4, 5].map(weekday => ({ tenantId, userId: person.id, weekday, startTime: '09:00', endTime: '18:00' })))
    }
  })
}
export async function saveAgendaSchedules(auth: AuthTokenPayload, userId: string, input: unknown) {
  const parsed = schedulesSchema.safeParse(input)
  if (!parsed.success) throw createError({ statusCode: 422, statusMessage: parsed.error.issues.map(v => v.message).join('. ') })
  return withTenant(auth.tenantId, async tx => {
    await requireAgendaBase(tx, auth.tenantId)
    if (!(await agendaActor(tx, auth, userId)).edit) throw createError({ statusCode: 403, statusMessage: 'Solo puedes editar tu propio horario.' })
    await agendaPerson(tx, auth.tenantId, userId)
    await agendaMutationLock(tx, auth.tenantId)
    await tx.delete(agendaSchedules).where(and(eq(agendaSchedules.tenantId, auth.tenantId), eq(agendaSchedules.userId, userId)))
    if (parsed.data.length) await tx.insert(agendaSchedules).values(parsed.data.map(row => ({ ...row, tenantId: auth.tenantId, userId })))
    return { ok: true }
  })
}
export async function saveAgendaTimeOff(auth: AuthTokenPayload, input: unknown, id?: string) {
  const parsed = timeOffSchema.safeParse(input)
  if (!parsed.success) throw createError({ statusCode: 422, statusMessage: parsed.error.issues.map(v => v.message).join('. ') })
  return withTenant(auth.tenantId, async tx => {
    await requireAgendaBase(tx, auth.tenantId)
    await agendaMutationLock(tx, auth.tenantId)
    if (!(await agendaActor(tx, auth, parsed.data.userId)).edit) throw createError({ statusCode: 403, statusMessage: 'No puedes administrar este bloqueo.' })
    if (parsed.data.userId) await agendaPerson(tx, auth.tenantId, parsed.data.userId)
    if (id) {
      const [old] = await tx.select().from(agendaTimeOff).where(and(eq(agendaTimeOff.id, id), eq(agendaTimeOff.tenantId, auth.tenantId))).limit(1)
      if (!old) throw createError({ statusCode: 404, statusMessage: 'Bloqueo no encontrado.' })
      if (!(await agendaActor(tx, auth, old.userId)).edit) throw createError({ statusCode: 403, statusMessage: 'No puedes editar este bloqueo.' })
      const [row] = await tx.update(agendaTimeOff).set(parsed.data).where(eq(agendaTimeOff.id, id)).returning()
      return row
    }
    const [row] = await tx.insert(agendaTimeOff).values({ ...parsed.data, tenantId: auth.tenantId }).returning()
    return row
  })
}
