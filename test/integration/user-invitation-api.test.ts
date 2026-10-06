import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'

const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'test' })
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: sendMailMock }) } }))

let testDb: TestDb
let admin: postgres.Sql
let invite: (event: any) => Promise<any>
const tenantId = randomUUID()
let adminRoleId: string
let memberRoleId: string
let adminUserId: string
let memberUserId: string

function event(roleId: string, userId: string, email: string) {
  return { context: { auth: { tenantId, roleId, sub: userId }, body: { email, roleId: memberRoleId } } }
}

beforeAll(async () => {
  vi.stubEnv('SETTINGS_ENCRYPTION_KEY', 'local-invitation-api-fixture-197')
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  process.env.APP_DATABASE_URL = testDb.appUrl
  process.env.APP_BASE_URL = 'https://app.erpdinamico.test'
  process.env.SMTP_HOST = 'smtp.test.local'
  process.env.SMTP_PORT = '587'
  process.env.SMTP_USER = 'user'
  process.env.SMTP_PASSWORD = 'pass'
  process.env.SMTP_FROM = 'Flow <no-responder@test.local>'

  await admin`insert into tenants (id, name) values (${tenantId}, 'Acme')`
  const [adminRole] = await admin`insert into roles (tenant_id, name, is_system) values (${tenantId}, 'Administrador', true) returning id`
  const [memberRole] = await admin`insert into roles (tenant_id, name, is_system) values (${tenantId}, 'Miembro', false) returning id`
  adminRoleId = adminRole.id
  memberRoleId = memberRole.id
  const [adminPerson] = await admin`insert into people (email, password_hash, full_name) values ('admin@acme.test', 'x', 'Admin') returning id`
  const [memberPerson] = await admin`insert into people (email, password_hash, full_name) values ('member@acme.test', 'x', 'Miembro') returning id`
  const [adminUser] = await admin`insert into users (tenant_id, role_id, person_id) values (${tenantId}, ${adminRoleId}, ${adminPerson.id}) returning id`
  const [memberUser] = await admin`insert into users (tenant_id, role_id, person_id) values (${tenantId}, ${memberRoleId}, ${memberPerson.id}) returning id`
  adminUserId = adminUser.id
  memberUserId = memberUser.id

  vi.stubGlobal('defineEventHandler', (handler: (event: any) => Promise<any>) => handler)
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('readValidatedBody', async (event: any, parse: any) => parse(event.context.body))
  vi.stubGlobal('setResponseStatus', () => {})
  invite = (await import('../../server/api/users/index.post')).default
}, 60_000)

afterAll(async () => {
  await admin?.end()
  await testDb?.stop()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('POST /api/users', () => {
  it('devuelve el enlace de invitación al administrador', async () => {
    const result = await invite(event(adminRoleId, adminUserId, 'invitado@acme.test'))
    expect(result.inviteUrl).toMatch(/^https:\/\/app\.erpdinamico\.test\/invitacion\/.+/)
  })

  it('rechaza a un usuario que no es administrador', async () => {
    await expect(invite(event(memberRoleId, memberUserId, 'otro@acme.test'))).rejects.toMatchObject({ statusCode: 403 })
  })
})
