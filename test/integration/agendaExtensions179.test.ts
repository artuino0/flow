import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import { withRecordActor } from '../../server/utils/recordActorContext'
import type { AuthTokenPayload } from '../../server/utils/auth'
vi.mock('../../server/utils/triggers', () => ({ fireTriggersForRecord: vi.fn() }))
let database: TestDb, admin: postgres.Sql, connection: typeof import('../../server/db')
let manager: typeof import('../../server/utils/agendaAdmin'), selection: typeof import('../../server/utils/agendaStaff')
const tenant = randomUUID(), other = randomUUID()
let owner: string, role: string, base: string, ordinary: string, reception: string, inactive: string, outsider: string, auth: AuthTokenPayload
const actor = <T>(fn: () => Promise<T>) => withRecordActor({ userId: owner, roleId: role }, fn)
beforeAll(async () => {
  database = await createTestDb(); admin = postgres(database.adminUrl, { onnotice: () => {} }); process.env.APP_DATABASE_URL = database.appUrl
  for (const id of [tenant, other]) await admin`insert into tenants(id,name,slug) values (${id},'ERD179',${'ext179-' + id})`
  const [ar] = await admin`insert into roles(tenant_id,name,is_system) values (${tenant},'Nombre administrativo personalizado',true) returning id`; role = ar!.id
  const [rr] = await admin`insert into roles(tenant_id,name) values (${tenant},'Recepción') returning id`
  const add = async (tid: string, name: string, rid: string | null, active = true) => {
    const [p] = await admin`insert into people(email,password_hash,full_name) values (${randomUUID() + '@test.local'},'x',${name}) returning id`
    const [u] = await admin`insert into users(tenant_id,person_id,role_id,is_active) values (${tid},${p!.id},${rid},${active}) returning id`
    return String(u!.id)
  }
  owner = await add(tenant, 'Owner', role); ordinary = await add(tenant, 'Sin rol', null)
  reception = await add(tenant, 'Recepción con horario', rr!.id); inactive = await add(tenant, 'Inactivo', role, false); outsider = await add(other, 'Otro tenant', null)
  auth = { sub: owner, roleId: role, tenantId: tenant } as AuthTokenPayload
  connection = await import('../../server/db'); manager = await import('../../server/utils/agendaAdmin'); selection = await import('../../server/utils/agendaStaff')
  const template = await import('../../server/utils/agendaTemplate'); await template.installAgendaTemplate(tenant)
  base = (await admin`select id from entities where tenant_id=${tenant} and slug='agenda-citas'`)[0]!.id
}, 90_000)
afterAll(async () => { await connection?.client.end(); await admin?.end(); await database?.stop(); delete process.env.APP_DATABASE_URL })
describe('Extensiones ERD179, base temporal y permisos reales', () => {
  it('owner único instala cinco días sin crear citas ni asignar otro rol', async () => {
    const rows = await admin`select weekday,start_time::text,end_time::text from agenda_schedules where tenant_id=${tenant} and user_id=${owner} order by weekday`
    expect(rows.map(row => row.weekday)).toEqual([1, 2, 3, 4, 5])
    expect(rows.every(row => row.start_time === '09:00:00' && row.end_time === '18:00:00')).toBe(true)
    expect(await admin`select id from records where entity_id=${base}`).toHaveLength(0)
    expect((await admin`select role_id from users where id=${owner}`)[0]!.role_id).toBe(role)
  })
  it('bootstrap simultáneo es idempotente y respeta rangos/vigencias existentes', async () => {
    await admin`delete from agenda_schedules where tenant_id=${tenant} and user_id=${owner}`
    const eligible = await actor(() => connection.withTenant(tenant, tx => selection.agendaStaff(tx, tenant)))
    expect(eligible.some(person => person.id === owner && !person.scheduled)).toBe(true)
    const results = await Promise.all(Array.from({ length: 12 }, () => actor(() => manager.createOwnDefaultAgendaSchedule(auth))))
    expect(results.filter(result => result.created)).toHaveLength(1)
    await admin`update agenda_schedules set start_time='08:30',valid_from='2026-10-01',valid_to='2026-12-31' where tenant_id=${tenant} and user_id=${owner} and weekday=1`
    await expect(actor(() => manager.createOwnDefaultAgendaSchedule(auth))).resolves.toEqual({ created: false })
    expect((await admin`select start_time::text,valid_from::text,valid_to::text from agenda_schedules where user_id=${owner} and weekday=1`)[0]).toMatchObject({ start_time: '08:30:00', valid_from: '2026-10-01', valid_to: '2026-12-31' })
  })
  it('selección excluye inactivo/otro tenant/sin horario y admite Recepción con horario', async () => {
    await actor(() => manager.saveAgendaSchedules(auth, reception, [{ weekday: 1, startTime: '09:00', endTime: '18:00' }]))
    const rows = await actor(() => connection.withTenant(tenant, tx => selection.agendaStaff(tx, tenant)))
    expect(rows.map(row => row.id).sort()).toEqual([owner, reception].sort())
    expect(rows.some(row => [ordinary, inactive, outsider].includes(row.id))).toBe(false)
    // Los candidatos administrables se consultan bajo tenant y permiten crear su primer horario.
    const candidates = await actor(() => connection.withTenant(tenant, tx => manager.agendaPeople(tx, tenant)))
    expect(candidates.some(person => person.id === ordinary)).toBe(true)
  })
  it('elegible sin rol edita propio; no gestión, force, bootstrap propio ni horario ajeno', async () => {
    await actor(() => manager.saveAgendaSchedules(auth, ordinary, [{ weekday: 1, startTime: '09:00', endTime: '18:00' }]))
    const [custom] = await admin`insert into roles(tenant_id,name) values (${tenant},'Operador') returning id`
    await admin`update users set role_id=${custom!.id} where id=${ordinary}`
    const own = { ...auth, sub: ordinary, roleId: custom!.id }
    const run = <T>(fn: () => Promise<T>) => withRecordActor({ userId: ordinary, roleId: custom!.id }, fn)
    await expect(run(() => connection.withTenant(tenant, tx => manager.agendaActor(tx, own, ordinary)))).resolves.toEqual({ manage: false, edit: true, force: false })
    await run(() => manager.saveAgendaSchedules(own, ordinary, [{ weekday: 2, startTime: '10:00', endTime: '12:00' }]))
    await expect(run(() => manager.saveAgendaSchedules(own, owner, []))).rejects.toMatchObject({ statusCode: 403 })
    await expect(run(() => manager.createOwnDefaultAgendaSchedule(own))).rejects.toMatchObject({ statusCode: 403 })
    expect(await admin`select id from records where entity_id=${base}`).toHaveLength(0)
  })
  it('upgrade canónico verifica propietario y preserva personalizaciones/históricos', async () => {
    const upgrade = await import('../../server/utils/agendaStaffField')
    await admin`update entity_fields set validation_rules='{"roles":["Personal"]}' where entity_id=${base} and name='personal'`
    await actor(() => connection.withTenant(other, tx => upgrade.upgradeAgendaStaffField(tx, other, base)))
    expect((await admin`select validation_rules from entity_fields where entity_id=${base} and name='personal'`)[0]!.validation_rules).toEqual({ roles: ['Personal'] })
    await actor(() => connection.withTenant(tenant, tx => upgrade.upgradeAgendaStaffField(tx, tenant, base)))
    expect((await admin`select validation_rules from entity_fields where entity_id=${base} and name='personal'`)[0]!.validation_rules).toEqual({ agendaStaff: true })
    await admin`update entity_fields set validation_rules='{"roles":["Recepción"],"multiple":true}' where entity_id=${base} and name='personal'`
    await actor(() => connection.withTenant(tenant, tx => upgrade.upgradeAgendaStaffField(tx, tenant, base)))
    expect((await admin`select validation_rules from entity_fields where entity_id=${base} and name='personal'`)[0]!.validation_rules).toEqual({ roles: ['Recepción'], multiple: true })
  })
  it('campo central permite administrador y horario, rechaza extranjeros/inactivos y conserva históricos', async () => {
    const userField = await import('../../server/utils/userField')
    const fields = [{ name: 'personal', dataType: 'user', validationRules: { agendaStaff: true } }]
    for (const id of [owner, ordinary, reception]) await actor(() => connection.withTenant(tenant, tx => userField.assertWritableUsers(tx, tenant, fields, { personal: id })))
    for (const id of [outsider, inactive]) await expect(actor(() => connection.withTenant(tenant, tx => userField.assertWritableUsers(tx, tenant, fields, { personal: id })))).rejects.toMatchObject({ statusCode: 422 })
    await actor(() => connection.withTenant(tenant, tx => userField.assertWritableUsers(tx, tenant, fields, { personal: inactive }, { personal: inactive })))
    const lookup = await actor(() => connection.withTenant(tenant, tx => userField.lookupUsers(tx, tenant)))
    expect(lookup.find(person => person.id === owner)?.agendaStaff).toBe(true)
    expect(lookup.find(person => person.id === inactive)?.agendaStaff).toBe(false)
  })
})
