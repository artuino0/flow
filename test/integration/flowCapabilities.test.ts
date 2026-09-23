import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type {
  getRoleFlowCapabilities as GetRoleFlowCapabilities,
  listAvailableFlowApps as ListAvailableFlowApps,
  resolveFlowCapabilities as ResolveFlowCapabilities,
  setRoleFlowCapabilities as SetRoleFlowCapabilities,
  setUserFlowCapabilityOverrides as SetUserFlowCapabilityOverrides
} from '../../server/utils/flowCapabilities'

const TENANT_A = randomUUID()
const TENANT_B = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let roleA: string
let roleB: string
let userA: string
let resolveFlowCapabilities: typeof ResolveFlowCapabilities
let getRoleFlowCapabilities: typeof GetRoleFlowCapabilities
let listAvailableFlowApps: typeof ListAvailableFlowApps
let setRoleFlowCapabilities: typeof SetRoleFlowCapabilities
let setUserFlowCapabilityOverrides: typeof SetUserFlowCapabilityOverrides

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  await admin`insert into tenants (id, name) values (${TENANT_A}, 'Tenant A'), (${TENANT_B}, 'Tenant B')`
  ;[{ tenant: TENANT_A, name: 'Operación' }, { tenant: TENANT_B, name: 'Otro rol' }].forEach(() => undefined)
  const [a] = await admin`insert into roles (tenant_id, name, is_system) values (${TENANT_A}, 'Operación', false) returning id`
  const [b] = await admin`insert into roles (tenant_id, name, is_system) values (${TENANT_B}, 'Otro rol', false) returning id`
  roleA = a.id as string
  roleB = b.id as string
  const [person] = await admin`insert into people (email, password_hash) values ('flow-capabilities@test.local', 'hash') returning id`
  const [user] = await admin`insert into users (tenant_id, person_id, role_id, is_active) values (${TENANT_A}, ${person.id}, ${roleA}, true) returning id`
  userA = user.id as string
  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ resolveFlowCapabilities, getRoleFlowCapabilities, listAvailableFlowApps, setRoleFlowCapabilities, setUserFlowCapabilityOverrides } = await import('../../server/utils/flowCapabilities'))
}, 60_000)

afterAll(async () => {
  await admin?.end()
  await testDb?.stop()
})

describe('permisos de aplicaciones de Flow', () => {
  it('usa los valores base y mantiene Core/Ajustes disponibles', async () => {
    const resolved = await resolveFlowCapabilities(TENANT_A, userA)
    expect(resolved?.effective).toMatchObject({
      'core.access': true,
      'settings.access': true,
      'communications.access': true,
      'automation.access': false,
      'sites.access': false,
      'billing.access': false
    })
  })

  it('expone solo aplicaciones habilitadas y accesibles para el launcher', async () => {
    const available = await listAvailableFlowApps(TENANT_A, userA)
    expect(available.apps).toHaveLength(6)
    expect(available.apps.find(app => app.key === 'core')).toMatchObject({ enabled: true, accessible: true })
    expect(available.apps.find(app => app.key === 'automation')).toMatchObject({ enabled: true, accessible: false })
  })
it('guarda permisos por rol y sincroniza Comunicaciones con Chat', async () => {
    const saved = await setRoleFlowCapabilities(TENANT_A, roleA, {
      'core.access': false,
      'automation.access': true,
      'communications.access': false,
      'sites.access': true,
      'billing.access': true,
      'settings.access': false
    })
    expect(saved?.permissions).toMatchObject({
      'core.access': true,
      'settings.access': true,
      'automation.access': true,
      'communications.access': false,
      'sites.access': true,
      'billing.access': true
    })
    const stored = await getRoleFlowCapabilities(TENANT_A, roleA)
    expect(stored?.permissions['communications.access']).toBe(false)
    const [chat] = await admin`select can_access from role_chat_permissions where role_id = ${roleA}`
    expect(chat.can_access).toBe(false)
  })

  it('prioriza la excepción individual sobre el rol', async () => {
    await setUserFlowCapabilityOverrides(TENANT_A, userA, {
      'core.access': false,
      'automation.access': false,
      'communications.access': true,
      'sites.access': null,
      'billing.access': null,
      'settings.access': false
    })
    const resolved = await resolveFlowCapabilities(TENANT_A, userA)
    expect(resolved?.effective).toMatchObject({
      'core.access': true,
      'settings.access': true,
      'automation.access': false,
      'communications.access': true,
      'sites.access': true,
      'billing.access': true
    })
    expect(resolved?.source['automation.access']).toBe('user')
    expect(resolved?.source['sites.access']).toBe('role')
  })

  it('no permite leer ni editar capacidades de otra organización', async () => {
    expect(await getRoleFlowCapabilities(TENANT_B, roleA)).toBeNull()
    expect(await setRoleFlowCapabilities(TENANT_B, roleA, {
      'core.access': true,
      'automation.access': true,
      'communications.access': true,
      'sites.access': true,
      'billing.access': true,
      'settings.access': true
    })).toBeNull()
    expect(await resolveFlowCapabilities(TENANT_B, userA)).toBeNull()
    expect(roleB).toBeTruthy()
  })
})
