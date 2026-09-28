import { eq } from 'drizzle-orm'
import type { AuthTokenPayload } from '~/server/utils/auth'
import { db, withTenant } from '~/server/db'
import { people, users, tenants } from '~/server/db/schema'

// GET /api/auth/me (HU-ERD-14/15, enriquecido en HU-ERD-22): el middleware
// global ya valido el JWT (header o cookie) y dejo el payload en
// event.context.auth. Aca se suma email/fullName (no van en el JWT para no
// quedar desactualizados) para que el frontend pueda mostrar quien esta
// logueado en el header (HU-ERD-21/22).
//
// HU multi-organizacion (2026-09-04): email/fullName/totpEnabled ya no
// viven en la fila de la membresia (`users`, auth.sub) sino en `people` (la
// persona) - se resuelve person_id primero (tenant-scoped, RLS real) y
// recien con eso se lee `people` (global, sin RLS).
export default defineEventHandler(async (event) => {
  const auth = event.context.auth as AuthTokenPayload

  const membership = await withTenant(auth.tenantId, async (tx) => {
    const [row] = await tx.select({ personId: users.personId, jobTitle: users.jobTitle, timezone: users.timezone }).from(users).where(eq(users.id, auth.sub)).limit(1)
    return row ?? null
  })

  const profile = membership
    ? (await db.select({ email: people.email, fullName: people.fullName, phone: people.phone, totpEnabled: people.totpEnabled, emailVerifiedAt: people.emailVerifiedAt }).from(people).where(eq(people.id, membership.personId)).limit(1))[0]
    : null

  const [organization] = await db.select({ name: tenants.name, country: tenants.country, idleTimeoutMinutes: tenants.idleTimeoutMinutes, idleWarningMinutes: tenants.idleWarningMinutes, onboardingStatus: tenants.onboardingStatus }).from(tenants).where(eq(tenants.id, auth.tenantId)).limit(1)
  return {
    id: auth.sub,
    tenantName: organization?.name,
    // Dominio fiscal fijo (DOCS/HU_Timbrado_CFDI_PAC.md): la nav muestra
    // "Facturación" solo cuando la organización es mexicana (decisión #3).
    country: organization?.country ?? 'MX',
    idleTimeoutMinutes: organization?.idleTimeoutMinutes ?? 30,
    idleWarningMinutes: organization?.idleWarningMinutes ?? 2,
    authenticated: true,
    emailVerified: Boolean(profile?.emailVerifiedAt),
    onboardingStatus: organization?.onboardingStatus ?? 'complete',
    sessionId: auth.sid,
    tenantId: auth.tenantId,
    roleId: auth.roleId,
    email: profile?.email ?? null,
    fullName: profile?.fullName ?? null,
    phone: profile?.phone ?? null,
    jobTitle: membership?.jobTitle ?? null,
    timezone: membership?.timezone ?? null,
    // HU-ERD-83 (parte 2): usado por pages/mi-cuenta.vue para saber si
    // mostrar "Activar 2FA" o "Desactivar 2FA" sin tener que llamar a otro
    // endpoint solo para eso.
    totpEnabled: profile?.totpEnabled ?? false
  }
})
