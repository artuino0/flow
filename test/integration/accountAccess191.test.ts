import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { createTestDb, type TestDb } from '../setup/testDb'

let database: TestDb, admin: postgres.Sql, connection: typeof import('../../server/db')
let authMiddleware: (event: { path: string; method?: string; context: Record<string, unknown> }) => Promise<void>
let token = ''
const tenant = randomUUID(), person = randomUUID(), role = randomUUID(), user = randomUUID()
beforeAll(async () => {
  vi.stubGlobal('createError', (options: Record<string, unknown>) => Object.assign(new Error(String(options.statusMessage ?? 'Error')), options))
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('getRequestURL', (event: { path: string }) => new URL(`http://localhost${event.path}`))
  vi.stubGlobal('getHeader', (_event: unknown, name: string) => name === 'authorization' ? `Bearer ${token}` : null)
  vi.stubGlobal('getCookie', () => null)
  vi.stubGlobal('useRuntimeConfig', () => ({ jwtSecret: 'account-test-191' }))
  database = await createTestDb(); admin = postgres(database.adminUrl, { onnotice: () => {} })
  process.env.APP_DATABASE_URL = database.appUrl
  await admin`insert into tenants(id,name,slug,onboarding_status) values (${tenant},'Cuenta sintética 191',${'account-' + tenant},'complete')`
  await admin`insert into roles(id,tenant_id,name,is_system) values (${role},${tenant},'Administrador',true)`
  await admin`insert into people(id,email,password_hash,full_name,email_verified_at) values (${person},${person + '@test.local'},'no-login','Prueba',now())`
  await admin`insert into users(id,tenant_id,person_id,role_id) values (${user},${tenant},${person},${role})`
  await admin`insert into tenant_subscriptions(tenant_id,plan_id,provider,status,current_period_end) select ${tenant},id,'stripe','canceled',now()-interval '10 days' from plans where key='starter'`
  connection = await import('../../server/db')
  token = (await import('../../server/utils/auth')).signAuthToken({ sub: user, tenantId: tenant, roleId: role }, 'account-test-191')
  authMiddleware = (await import('../../server/middleware/auth')).default as typeof authMiddleware
}, 120000)
afterAll(async () => { await connection?.client.end(); await admin?.end(); await database?.stop(); delete process.env.APP_DATABASE_URL; vi.unstubAllGlobals() })

describe('191: regresión del hueco de acceso', () => {
  it('cancelada con periodo terminado no accede a módulos', async () => {
    await expect(authMiddleware({ path: '/api/entities', context: {} })).rejects.toMatchObject({ statusCode: 403 })
  })
  it('past_due sigue funcionando durante la gracia', async () => {
    await admin`update tenant_subscriptions set status='past_due',updated_at=now() where tenant_id=${tenant}`
    await expect(authMiddleware({ path: '/api/entities', context: {} })).resolves.toBeUndefined()
  })
  it.each(['/api/entities', '/api/records/test', '/api/files', '/api/sites', '/api/agenda/settings', '/api/triggers', '/api/reports', '/api/chat/conversations', '/api/agent/messages', '/api/users', '/api/tenant', '/api/nav/entities', '/api/billing/plan-usage', '/api/apps', '/api/notifications'])('suspendida bloquea la familia %s aunque tenga token de administrador', async path => {
    await admin`update tenant_subscriptions set status='canceled' where tenant_id=${tenant}`
    await expect(authMiddleware({ path, method: 'POST', context: {} })).rejects.toMatchObject({ statusCode: 403 })
  })
  it('administrador conserva pago/exportación, miembro recibe solo etapa/mensaje y plataforma se verifica en el handler', async () => {
    await expect(authMiddleware({ path: '/api/account/export', context: {} })).resolves.toBeUndefined()
    await expect(authMiddleware({ path: '/api/billing/portal', context: {} })).resolves.toBeUndefined()
    await admin`update roles set is_system=false where id=${role}`
    await expect(authMiddleware({ path: '/api/account/export', context: {} })).rejects.toMatchObject({ statusCode: 403 })
    await expect(authMiddleware({ path: '/api/billing/portal', context: {} })).rejects.toMatchObject({ statusCode: 403 })
    await expect(authMiddleware({ path: '/api/account/status', context: {} })).resolves.toBeUndefined()
    await expect((await import('../../server/utils/platformAdmin')).requirePlatformAdmin({ context: { auth: { sub: user, tenantId: tenant } } } as any)).rejects.toMatchObject({ statusCode: 403 })
  })
})
