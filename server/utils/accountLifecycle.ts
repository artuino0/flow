import { and, eq, sql } from 'drizzle-orm'
import { createError, type H3Event } from 'h3'
import { db, withTenantRecovery } from '~/server/db'
import { roles, users } from '~/server/db/schema'
import { requireAuth } from './rbac'
import { accountBlocked, type AccountLifecycle } from '~/utils/accountLifecycle'

export async function accountLifecycle(tenantId: string, now = new Date()): Promise<AccountLifecycle> {
  return withTenantRecovery(tenantId, async tx => {
    const rows = await tx.execute(sql`select account_lifecycle_state(${tenantId}::uuid,${now.toISOString()}::timestamptz,${process.env.PLATFORM_CRM_TENANT_SLUG ?? ''}) as account`)
    const state = rows[0]?.account as AccountLifecycle | undefined
    if (!state?.phase) throw createError({ statusCode: 503, statusMessage: 'No se pudo comprobar el estado de la cuenta.' })
    return state
  })
}
export async function assertAccountActive(tenantId: string) {
  if (accountBlocked(await accountLifecycle(tenantId))) throw createError({ statusCode: 403, statusMessage: 'La cuenta está suspendida, contacta al administrador.' })
}
export async function publicAccountBlocked(hostname: string) {
  const rows = await db.execute(sql`select public_site_account(${hostname},${new Date().toISOString()}::timestamptz,${process.env.PLATFORM_CRM_TENANT_SLUG ?? ''}) as account`)
  const state = rows[0]?.account as AccountLifecycle | null | undefined
  return state ? accountBlocked(state) : false
}
export async function requireAccountAdmin(event: H3Event) {
  const auth = requireAuth(event)
  if (event.context.apiKeyId) throw createError({ statusCode: 403, statusMessage: 'Esta acción requiere una sesión de administrador.' })
  const [member] = await withTenantRecovery(auth.tenantId, tx => tx.select({ admin: roles.isSystem }).from(users)
    .innerJoin(roles, eq(roles.id, users.roleId)).where(and(eq(users.id, auth.sub), eq(users.tenantId, auth.tenantId), eq(users.isActive, true))).limit(1))
  if (!member?.admin) throw createError({ statusCode: 403, statusMessage: 'La cuenta está suspendida, contacta al administrador.' })
  if ((await accountLifecycle(auth.tenantId)).reason === 'deletion_started') throw createError({ statusCode: 409, statusMessage: 'El borrado ya comenzó. Contacta al equipo de Flow.' })
  return auth
}
export const ACCOUNT_RECOVERY_PATHS = new Set(['/api/account/status', '/api/account/export', '/api/account/export/download', '/api/billing/plans', '/api/billing/checkout', '/api/billing/portal'])
