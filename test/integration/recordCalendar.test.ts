import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { createError } from 'h3'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import { withRecordActor } from '../../server/utils/recordActorContext'

const tenantId = randomUUID()
let testDb: TestDb
let admin: postgres.Sql
let calendarGet: (event: any) => Promise<any>
let patchRecord: (event: any) => Promise<any>
let personalRole: string
let receptionRole: string
let readerRole: string
let personalOne: string
let personalTwo: string
let receptionUser: string
let entityId: string
let ownedRecordId: string
let otherRecordId: string

const event = (userId: string, roleId: string, query: Record<string, string> = {}) => ({
  context: { auth: { tenantId, roleId, sub: userId }, params: { entity: 'citas' }, query }
})

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  await admin`insert into tenants (id, name) values (${tenantId}, 'Calendario QA')`
  const [personal] = await admin`insert into roles (tenant_id, name, is_system) values (${tenantId}, 'Personal', false) returning id`
  const [reception] = await admin`insert into roles (tenant_id, name, is_system) values (${tenantId}, 'Recepción', false) returning id`
  const [reader] = await admin`insert into roles (tenant_id, name, is_system) values (${tenantId}, 'Lector', false) returning id`
  personalRole = personal.id; receptionRole = reception.id; readerRole = reader.id
  for (const [email, role] of [['personal1@test.local', personalRole], ['personal2@test.local', personalRole], ['recepcion@test.local', receptionRole], ['lector@test.local', readerRole]]) {
    const [person] = await admin`insert into people (email, password_hash, full_name) values (${email}, 'x', ${email}) returning id`
    const [user] = await admin`insert into users (tenant_id, role_id, person_id) values (${tenantId}, ${role}, ${person.id}) returning id`
    if (email.startsWith('personal1')) personalOne = user.id
    else if (email.startsWith('personal2')) personalTwo = user.id
    else if (email.startsWith('recepcion')) receptionUser = user.id
  }
  const calendarConfig = { enabled: true, startDateField: 'fecha', startTimeField: 'hora', durationField: null, endField: null, titleField: 'asunto', colorField: null, groupByField: 'personal', defaultView: 'day' }
  const [entity] = await admin`insert into entities (tenant_id, name, slug, calendar_config) values (${tenantId}, 'Citas', 'citas', ${admin.json(calendarConfig)}) returning id`
  entityId = entity!.id
  await admin`insert into entity_fields (entity_id, name, label, data_type, is_required, is_owner_field) values
    (${entityId}, 'fecha', 'Fecha', 'date', true, false),
    (${entityId}, 'hora', 'Hora', 'text', false, false),
    (${entityId}, 'asunto', 'Asunto', 'text', false, false),
    (${entityId}, 'personal', 'Personal', 'user', false, true)`
  await admin`insert into role_entity_permissions (role_id, entity_id, can_read, can_create, can_update, can_delete, visibility) values
    (${personalRole}, ${entityId}, true, true, true, false, 'own'),
    (${receptionRole}, ${entityId}, true, true, true, false, 'all'),
    (${readerRole}, ${entityId}, true, false, false, false, 'all')`
  const [ownedRecord] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${tenantId}, ${entityId}, ${admin.json({ fecha: '2025-09-17', hora: '09:00', asunto: 'Cita propia', personal: personalOne })}) returning id`
  const [otherRecord] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${tenantId}, ${entityId}, ${admin.json({ fecha: '2025-09-17', hora: '10:00', asunto: 'Cita ajena', personal: personalTwo })}) returning id`
  ownedRecordId = ownedRecord!.id
  otherRecordId = otherRecord!.id
  await admin`insert into records (tenant_id, entity_id, custom_data) values (${tenantId}, ${entityId}, ${admin.json({ fecha: '2025-10-01', hora: '11:00', asunto: 'Fuera del rango', personal: personalOne })})`

  process.env.APP_DATABASE_URL = testDb.appUrl
  vi.stubGlobal('defineEventHandler', (handler: (event: any) => Promise<unknown>) => handler)
  vi.stubGlobal('getRouterParam', (request: any, name: string) => request.context.params[name])
  vi.stubGlobal('getValidatedQuery', async (request: any, parse: (value: unknown) => unknown) => parse(request.context.query))
  vi.stubGlobal('readValidatedBody', async (request: any, parse: (value: unknown) => unknown) => parse(request.context.body))
  vi.stubGlobal('createError', createError)
  calendarGet = (await import('../../server/api/records/[entity]/calendar.get')).default
  patchRecord = (await import('../../server/api/records/[entity]/[id].patch')).default
}, 60_000)

afterAll(async () => { await admin?.end(); await testDb?.stop(); vi.unstubAllGlobals() })

describe('calendario de registros (PostgreSQL y RLS)', () => {
  it('limita los eventos al rango y la política Solo los suyos; recepción ve todas las citas del rango', async () => {
    const query = { from: '2025-09-01', to: '2025-10-01' }
    const personal = await withRecordActor({ userId: personalOne, roleId: personalRole }, () => calendarGet(event(personalOne, personalRole, query)))
    const reception = await withRecordActor({ userId: receptionUser, roleId: receptionRole }, () => calendarGet(event(receptionUser, receptionRole, query)))
    expect(personal.events.map((item: { id: string }) => item.id)).toEqual([ownedRecordId])
    expect(reception.events.map((item: { id: string }) => item.id).sort()).toEqual([ownedRecordId, otherRecordId].sort())
    expect(reception.events.every((item: { date: string }) => item.date >= query.from && item.date < query.to)).toBe(true)
  })

  it('mueve fecha y hora usando PATCH y rechaza a un rol sin permiso de edición', async () => {
    const moved = await withRecordActor({ userId: personalOne, roleId: personalRole }, () => patchRecord({
      ...event(personalOne, personalRole), context: { ...event(personalOne, personalRole).context, params: { entity: 'citas', id: ownedRecordId }, body: { changes: { fecha: '2025-09-18', hora: '13:00' } } }
    }))
    expect(String(moved.customData.fecha).slice(0, 10)).toBe('2025-09-18')
    expect(moved.customData.hora).toBe('13:00')
    await expect(withRecordActor({ userId: receptionUser, roleId: readerRole }, () => patchRecord({
      ...event(receptionUser, readerRole), context: { ...event(receptionUser, readerRole).context, params: { entity: 'citas', id: ownedRecordId }, body: { changes: { fecha: '2025-09-19' } } }
    }))).rejects.toMatchObject({ statusCode: 403 })
  })
})
