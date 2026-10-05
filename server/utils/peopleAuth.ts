import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { db, withPerson } from '~/server/db'
import { people, tenants, users } from '~/server/db/schema'
import { issueSessionCookies, signPendingOrgToken } from '~/server/utils/auth'
import { createLoginSession } from '~/server/utils/authUser'

// HU multi-organizacion (2026-09-04): resolucion GLOBAL de identidad en el
// momento del login, antes de que exista ningun tenant elegido - por
// definicion una consulta cross-tenant deliberada, igual que la que ya hace
// server/api/auth/login.post.ts para resolver el unico tenant del modo
// "dedicated" (`db.select(...).from(tenants)`, sin withTenant()). `people`
// no tiene tenant_id/RLS (mismo criterio que `tenants`, ver el comentario
// largo en server/db/schema.ts), asi que leerla directo con `db` no esquiva
// ningun aislamiento - simplemente no hay ninguno que aplicar aca.
//
// `users` (la membresia) es distinto: SI tiene RLS, con FORCE ROW LEVEL
// SECURITY (migracion 0010) - leerla con `db` directo, sin ningun contexto,
// no "esquiva" el aislamiento, lo GATILLA: la policy exige
// current_setting('app.tenant_id', true)::uuid = tenant_id, y sin tenant
// conocido eso nunca es true (0 filas siempre, o un error de cast a uuid en
// una conexion pooled que ya uso set_config antes - bug real, encontrado en
// produccion, arreglado en la migracion 0031). listActiveMembershipsForPerson
// y findActiveMembership usan withPerson() (server/db/index.ts) en vez de
// `db` para esto: setea app.person_id, que la policy self_membership_lookup_users
// (migracion 0031) usa para permitir ver, de forma angosta, las PROPIAS
// membresias de esa persona en cualquier tenant - sin necesitar bypass de RLS.

export interface PersonRow {
  id: string
  email: string
  passwordHash: string
  fullName: string | null
  totpSecret: string | null
  totpEnabled: boolean
}

export async function findPersonByEmail(email: string): Promise<PersonRow | null> {
  const [row] = await db
    .select({
      id: people.id,
      email: people.email,
      passwordHash: people.passwordHash,
      fullName: people.fullName,
      totpSecret: people.totpSecret,
      totpEnabled: people.totpEnabled
    })
    .from(people)
    .where(eq(people.email, email.trim().toLowerCase()))
    .limit(1)
  return row ?? null
}

export async function findPersonById(personId: string): Promise<PersonRow | null> {
  const [row] = await db
    .select({
      id: people.id,
      email: people.email,
      passwordHash: people.passwordHash,
      fullName: people.fullName,
      totpSecret: people.totpSecret,
      totpEnabled: people.totpEnabled
    })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1)
  return row ?? null
}

export interface MembershipOption {
  userId: string
  tenantId: string
  tenantName: string
  roleId: string | null
}

/**
 * Todas las membresias ACTIVAS de una persona, en cualquier tenant - la
 * base para decidir "entra directo" (1 resultado, HU-ERD-35 sigue igual) vs.
 * "elegir organización" (>1 resultado, pantalla nueva). Una membresia
 * isActive=false (invitacion todavia pendiente, o cuenta desactivada en ese
 * tenant puntual) NUNCA aparece aca, ni siquiera para contar - no puede
 * loguear ahi, mismo criterio que el login de un solo tenant ya aplicaba.
 */
export async function listActiveMembershipsForPerson(personId: string): Promise<MembershipOption[]> {
  return withPerson(personId, (tx) =>
    tx
      .select({
        userId: users.id,
        tenantId: users.tenantId,
        tenantName: tenants.name,
        roleId: users.roleId
      })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(and(eq(users.personId, personId), eq(users.isActive, true)))
      .orderBy(tenants.name)
  )
}

/**
 * Confirma que `personId` tiene una membresia activa en `tenantId` puntual y
 * la devuelve - usado por login/select-org.post.ts (el usuario eligio una
 * organizacion, no hay que volver a listar todas) y es deliberadamente mas
 * angosto que listActiveMembershipsForPerson (evita traer las demas).
 */
export async function findActiveMembership(personId: string, tenantId: string): Promise<{ userId: string; roleId: string | null } | null> {
  const rows = await withPerson(personId, (tx) =>
    tx
      .select({ userId: users.id, roleId: users.roleId })
      .from(users)
      .where(and(eq(users.personId, personId), eq(users.tenantId, tenantId), eq(users.isActive, true)))
      .limit(1)
  )
  return rows[0] ?? null
}

export type LoginResolution =
  | { ok: true; requiresTotp: false; requiresOrgSelection: false; user: Awaited<ReturnType<typeof createLoginSession>> }
  | { ok: true; requiresTotp: false; requiresOrgSelection: true; pendingToken: string; organizations: { tenantId: string; tenantName: string }[] }

/**
 * Punto de union de los DOS caminos que terminan en "la contraseña (y el
 * codigo TOTP, si aplica) ya se validaron - ahora hay que decidir la
 * organización": server/api/auth/login.post.ts (sin 2FA) y
 * server/api/auth/login/totp.post.ts (con 2FA, despues del codigo). Una sola
 * membresia activa = sesion real de una (mismo comportamiento de siempre,
 * HU-ERD-35 incluido - la organización nunca se pregunta). Mas de una =
 * devuelve el pendingToken + la lista para que el cliente pida elegir
 * (POST /api/auth/login/select-org). Cero membresias activas = mismo 401
 * generico que credenciales invalidas (no distingue "existis pero no tenes
 * acceso a ningun lado" de "no existis", mismo criterio de siempre).
 */
export async function resolveLoginResult(event: H3Event, personId: string, secret: string): Promise<LoginResolution> {
  const memberships = await listActiveMembershipsForPerson(personId)
  if (memberships.length === 0) {
    throw createError({ statusCode: 401, statusMessage: 'Credenciales invalidas' })
  }
  if (memberships.length === 1) {
    const membership = memberships[0]
    const payload = { sub: membership.userId, tenantId: membership.tenantId, roleId: membership.roleId }
    const user = await createLoginSession(event, payload)
    await issueSessionCookies(event, { ...payload, sid: user.sessionId }, secret)
    return { ok: true, requiresTotp: false, requiresOrgSelection: false, user }
  }
  const pendingToken = signPendingOrgToken({ sub: personId }, secret)
  return {
    ok: true,
    requiresTotp: false,
    requiresOrgSelection: true,
    pendingToken,
    organizations: memberships.map((m) => ({ tenantId: m.tenantId, tenantName: m.tenantName }))
  }
}
