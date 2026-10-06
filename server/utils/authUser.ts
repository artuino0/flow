import { and, eq, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { withTenantRecovery as withTenant } from '~/server/db'
import { people, users, tenants, roles } from '~/server/db/schema'
import type { AuthTokenPayload } from '~/server/utils/auth'
import { adminRoleAllowed } from '~/server/utils/rbac'
import { accountLifecycle } from '~/server/utils/accountLifecycle'
import type { AccountLifecycle } from '~/utils/accountLifecycle'

type AuthProfile = {
  accountLifecycle?: AccountLifecycle
  tenantHasLogo: boolean | null
  tenantName: string | null; country: string | null; idleTimeoutMinutes: number | null; idleWarningMinutes: number | null
  onboardingStatus: string | null
  email: string | null; fullName: string | null; phone: string | null; emailVerifiedAt: Date | string | null
  totpEnabled: boolean | null; jobTitle: string | null; timezone: string | null; roleId: string | null; isSystem: boolean | null
}

/** Perfil público común: sin contraseña, secretos TOTP ni tokens. Las membresías conservan RLS. */
export async function loadAuthUser(auth: AuthTokenPayload, apiKey = false) {
  const profile = await withTenant(auth.tenantId, async tx => {
      const [row] = await tx.select({
        accountLifecycle: sql<AccountLifecycle>`account_lifecycle_state(${auth.tenantId}::uuid,${new Date().toISOString()}::timestamptz,${process.env.PLATFORM_CRM_TENANT_SLUG ?? ''})`,
        tenantName: tenants.name, tenantHasLogo: sql<boolean>`${tenants.logoStorageKey} IS NOT NULL`, country: tenants.country,
        idleTimeoutMinutes: tenants.idleTimeoutMinutes, idleWarningMinutes: tenants.idleWarningMinutes,
        onboardingStatus: tenants.onboardingStatus, email: people.email, fullName: people.fullName,
        phone: people.phone, emailVerifiedAt: people.emailVerifiedAt, totpEnabled: people.totpEnabled,
        jobTitle: users.jobTitle, timezone: users.timezone, roleId: users.roleId, isSystem: roles.isSystem
      }).from(users).leftJoin(people, eq(people.id, users.personId)).leftJoin(tenants, eq(tenants.id, users.tenantId))
        .leftJoin(roles, eq(roles.id, users.roleId))
        .where(and(eq(users.id, auth.sub), eq(users.tenantId, auth.tenantId))).limit(1)
      return row
    })
  return { ...publicAuthUser(auth, profile, apiKey), accountLifecycle: profile?.accountLifecycle ?? await accountLifecycle(auth.tenantId) }
}

function publicAuthUser(auth: AuthTokenPayload, profile: AuthProfile | undefined, apiKey = false) {
  const roleId = profile ? profile.roleId : auth.roleId
  const isAdmin = adminRoleAllowed(profile?.isSystem, apiKey)
  return {
    id: auth.sub, sessionId: auth.sid, tenantId: auth.tenantId, roleId,
    tenantName: profile?.tenantName, tenantHasLogo: Boolean(profile?.tenantHasLogo), country: profile?.country ?? 'MX',
    idleTimeoutMinutes: profile?.idleTimeoutMinutes ?? 30, idleWarningMinutes: profile?.idleWarningMinutes ?? 2,
    authenticated: true, emailVerified: Boolean(profile?.emailVerifiedAt), onboardingStatus: profile?.onboardingStatus ?? 'complete',
    email: profile?.email ?? null, fullName: profile?.fullName ?? null, phone: profile?.phone ?? null,
    jobTitle: profile?.jobTitle ?? null, timezone: profile?.timezone ?? null, totpEnabled: profile?.totpEnabled ?? false,
    isAdmin,
    isPlatformAdmin: !apiKey && Boolean(profile?.email && (process.env.PLATFORM_ADMIN_EMAILS ?? '').split(',').map(value => value.trim().toLowerCase()).includes(profile.email.toLowerCase()))
  }
}

/** El INSERT de sesión ya hace un viaje: devuelve también el perfil con las mismas RLS. */
export async function createLoginSession(event: H3Event, auth: AuthTokenPayload) {
  const profile = await withTenant(auth.tenantId, async tx => {
    const rows = await tx.execute<AuthProfile & { sessionId: string }>(sql`
      WITH created AS (
        INSERT INTO auth_sessions (tenant_id, user_id, user_agent, expires_at)
        VALUES (${auth.tenantId}::uuid, ${auth.sub}::uuid, ${(getHeader(event, 'user-agent') || '').slice(0, 500)}, now() + interval '7 days')
        RETURNING id
      )
      SELECT created.id AS "sessionId", u.role_id AS "roleId", r.is_system AS "isSystem",
        account_lifecycle_state(${auth.tenantId}::uuid,${new Date().toISOString()}::timestamptz,${process.env.PLATFORM_CRM_TENANT_SLUG ?? ''}) AS "accountLifecycle",
        t.name AS "tenantName", t.logo_storage_key IS NOT NULL AS "tenantHasLogo", t.country, t.idle_timeout_minutes AS "idleTimeoutMinutes",
        t.idle_warning_minutes AS "idleWarningMinutes", t.onboarding_status AS "onboardingStatus",
        p.email, p.full_name AS "fullName", p.phone, p.email_verified_at AS "emailVerifiedAt",
        p.totp_enabled AS "totpEnabled", u.job_title AS "jobTitle", u.timezone
      FROM created LEFT JOIN users u ON u.id = ${auth.sub}::uuid AND u.tenant_id = ${auth.tenantId}::uuid
      LEFT JOIN people p ON p.id = u.person_id LEFT JOIN tenants t ON t.id = u.tenant_id
      LEFT JOIN roles r ON r.id = u.role_id
    `)
    return rows[0]
  })
  return { ...publicAuthUser({ ...auth, sid: profile.sessionId }, profile), accountLifecycle: profile.accountLifecycle ?? await accountLifecycle(auth.tenantId) }
}
