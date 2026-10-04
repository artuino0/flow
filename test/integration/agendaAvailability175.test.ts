import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { createError } from 'h3'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import { withRecordActor, withSystemRecordAccess } from '../../server/utils/recordActorContext'
import type { AuthTokenPayload } from '../../server/utils/auth'
vi.mock('../../server/utils/triggers', () => ({ fireTriggersForRecord: vi.fn() }))
let database: TestDb, admin: postgres.Sql, app: postgres.Sql
let agenda: typeof import('../../server/utils/agendaTemplate'), manager: typeof import('../../server/utils/agendaAdmin'), availability: typeof import('../../server/utils/agendaAvailability')
let connection: typeof import('../../server/db')
const tenant = randomUUID(), otherTenant = randomUUID()
let staff: string, adminId: string, staffRole: string, adminRole: string, baseId: string, clientId: string
let auth: AuthTokenPayload, staffAuth: AuthTokenPayload
beforeAll(async () => {
  database = await createTestDb(); admin = postgres(database.adminUrl, { onnotice: () => {} }); app = postgres(database.appUrl, { max: 20, onnotice: () => {} })
  process.env.APP_DATABASE_URL = database.appUrl
  for (const id of [tenant, otherTenant]) await admin`insert into tenants(id,name,slug) values (${id},'Agenda 175',${'agenda175-' + id})`
  const [ar] = await admin`insert into roles(tenant_id,name,is_system) values (${tenant},'Administrador',true) returning id`; adminRole = ar!.id
  const [sr] = await admin`insert into roles(tenant_id,name) values (${tenant},'Personal') returning id`; staffRole = sr!.id
  for (const [role, name] of [[adminRole, 'Administrador'], [staffRole, 'Personal']] as const) {
    const [person] = await admin`insert into people(email,password_hash,full_name) values (${randomUUID() + '@test.local'},'x',${name}) returning id`
    const [user] = await admin`insert into users(tenant_id,person_id,role_id) values (${tenant},${person!.id},${role}) returning id`
    if (role === adminRole) adminId = user!.id; else staff = user!.id
  }
  auth = { sub: adminId, tenantId: tenant, roleId: adminRole } as AuthTokenPayload
  staffAuth = { sub: staff, tenantId: tenant, roleId: staffRole } as AuthTokenPayload
  agenda = await import('../../server/utils/agendaTemplate'); manager = await import('../../server/utils/agendaAdmin'); availability = await import('../../server/utils/agendaAvailability'); connection = await import('../../server/db')
  await agenda.installAgendaTemplate(tenant)
  const [base] = await admin`select id from entities where tenant_id=${tenant} and slug='agenda-citas'`; baseId = base!.id
  const [client] = await admin`insert into records(tenant_id,entity_id,custom_data) values (${tenant},(select id from entities where tenant_id=${tenant} and slug='agenda-clientes'),' {"nombre":"Cliente local"}') returning id`; clientId = client!.id
}, 90_000)
afterAll(async () => { await connection?.client.end(); await app?.end(); await admin?.end(); await database?.stop() })
const actor = <T>(fn: () => Promise<T>) => withRecordActor({ userId: adminId, roleId: adminRole }, fn)
const slot = (time = '09:00') => ({ tenantId: tenant, userId: staff, date: '2026-10-05', time, duration: 30, customData: { asunto: 'Prueba local', cliente: clientId }, now: Date.parse('2026-10-04T12:00:00Z') })
async function rawWrite(data: Record<string, string | number>, reason?: string) {
  return app.begin(async tx => {
    await tx`select set_config('app.tenant_id',${tenant},true), set_config('app.person_id','00000000-0000-0000-0000-000000000000',true),set_config('app.user_id',${adminId},true),set_config('app.role_id',${adminRole},true),set_config('app.record_system','on',true)`
    if (reason) await tx`select set_config('app.agenda_force_reason',${reason},true)`
    return tx`insert into records(tenant_id,entity_id,custom_data) values (${tenant},${baseId},${tx.json(data)}) returning *`
  })
}
describe('Agenda 175, PostgreSQL real sin red externa', () => {
  it('PostgreSQL usa los mismos instantes que Intl en DST y cambios de media hora', async () => {
    const [row] = await admin`select agenda_local_instant('2026-11-01 01:30','America/New_York') as repeated,
      agenda_local_instant('2026-03-08 02:30','America/New_York') as skipped,
      agenda_local_instant('2026-04-05 01:45','Australia/Lord_Howe') as half_hour`
    expect(new Date(row!.repeated).toISOString()).toBe('2026-11-01T05:30:00.000Z')
    expect(row!.skipped).toBeNull()
    expect(new Date(row!.half_hour).toISOString()).toBe('2026-04-04T14:45:00.000Z')
  })
  it('instalación idempotente crea ajustes y cinco días por Personal sin pisar horario', async () => {
    expect(await admin`select * from agenda_settings where tenant_id=${tenant}`).toHaveLength(1)
    expect(await admin`select * from agenda_schedules where tenant_id=${tenant} and user_id=${staff}`).toHaveLength(5)
    await admin`update agenda_schedules set start_time='08:00' where tenant_id=${tenant} and user_id=${staff} and weekday=2`
    await agenda.installAgendaTemplate(tenant)
    expect((await admin`select start_time::text from agenda_schedules where tenant_id=${tenant} and user_id=${staff} and weekday=2`)[0]!.start_time).toBe('08:00:00')
    expect(await admin`select * from agenda_schedules where tenant_id=${tenant} and user_id=${staff}`).toHaveLength(5)
  })
  it('Personal edita propio y no ajeno; bloqueos generales requieren administración', async () => {
    const schedules = [{ weekday: 1, startTime: '09:00', endTime: '18:00' }]
    await withRecordActor({ userId: staff, roleId: staffRole }, () => manager.saveAgendaSchedules(staffAuth, staff, schedules))
    await expect(withRecordActor({ userId: staff, roleId: staffRole }, () => manager.saveAgendaSchedules(staffAuth, adminId, schedules))).rejects.toMatchObject({ statusCode: 403 })
    await expect(withRecordActor({ userId: staff, roleId: staffRole }, () => manager.saveAgendaTimeOff(staffAuth, { userId: null, startLocal: '2026-10-06T00:00', endLocal: '2026-10-07T00:00', allDay: true, reason: 'Festivo' }))).rejects.toMatchObject({ statusCode: 403 })
    const off = await actor(() => manager.saveAgendaTimeOff(auth, { userId: null, startLocal: '2026-10-06T00:00', endLocal: '2026-10-07T00:00', allDay: true, reason: 'Festivo' }))
    await expect(withRecordActor({ userId: staff, roleId: staffRole }, () => manager.saveAgendaTimeOff(staffAuth, { userId: staff, startLocal: '2026-10-06T00:00', endLocal: '2026-10-07T00:00', allDay: true, reason: 'Robado' }, off!.id))).rejects.toMatchObject({ statusCode: 403 })
  })
  it('RLS aísla las tres tablas aun sin filtros SQL y niega inserción extranjera', async () => {
    await app.begin(async tx => {
      await tx`select set_config('app.tenant_id',${otherTenant},true),set_config('app.person_id','00000000-0000-0000-0000-000000000000',true)`
      for (const table of ['agenda_settings', 'agenda_schedules', 'agenda_time_off']) expect(await tx.unsafe('select * from ' + table)).toHaveLength(0)
      expect(await tx`select * from agenda_occupancy(${tenant})`).toHaveLength(0)
    })
    await expect(app.begin(async tx => { await tx`select set_config('app.tenant_id',${otherTenant},true)`; await tx`insert into agenda_settings(tenant_id) values (${tenant})` })).rejects.toMatchObject({ code: '42501' })
    await expect(app.begin(async tx => { await tx`select set_config('app.tenant_id',${otherTenant},true),set_config('app.person_id','00000000-0000-0000-0000-000000000000',true)`; await tx`insert into agenda_schedules(tenant_id,user_id,weekday,start_time,end_time) values (${otherTenant},${staff},1,'09:00','10:00')` })).rejects.toMatchObject({ code: '42501' })
  })
  it('validaciones de BD rechazan rangos, ajustes y traslapes', async () => {
    await expect(admin`update agenda_settings set slot_minutes=4 where tenant_id=${tenant}`).rejects.toMatchObject({ code: '23514' })
    await expect(admin`insert into agenda_schedules(tenant_id,user_id,weekday,start_time,end_time) values (${tenant},${staff},1,'10:00','09:00')`).rejects.toMatchObject({ code: '23514' })
    await expect(admin`insert into agenda_schedules(tenant_id,user_id,weekday,start_time,end_time) values (${tenant},${staff},1,'10:00','11:00')`).rejects.toMatchObject({ code: '23514' })
  })
  it('20 reservas simultáneas al mismo hueco producen exactamente un éxito', async () => {
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => actor(() => availability.reserveSlot(slot()))))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    for (const result of results) if (result.status === 'rejected') expect(result.reason).toMatchObject({ statusCode: 409 })
    expect(await admin`select id from records where entity_id=${baseId}`).toHaveLength(1)
    expect((await admin`select custom_data from records where entity_id=${baseId}`)[0]!.custom_data.estado).toBe('agendada')
  }, 60_000)
  it('20 escrituras internas directas usan el mismo candado', async () => {
    const data = { personal: staff, fecha: '2026-10-05', hora: '10:00', duracion_minutos: 30, estado: 'agendada', asunto: 'Interna', cliente: clientId }
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => rawWrite(data)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    for (const result of results) if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: '23P01' })
  }, 60_000)
  it('edición interna impide choques; cancelada libera; buffer y medianoche protegidos', async () => {
    const data = { personal: staff, fecha: '2026-10-05', hora: '11:00', duracion_minutos: 30, estado: 'agendada' }
    const [row] = await rawWrite(data)
    await expect(app.begin(async tx => {
      await tx`select set_config('app.tenant_id',${tenant},true),set_config('app.person_id','00000000-0000-0000-0000-000000000000',true),set_config('app.record_system','on',true)`
      await tx`update records set custom_data=custom_data || '{"hora":"10:00"}'::jsonb where id=${row!.id}`
    })).rejects.toMatchObject({ code: '23P01' })
    await rawWrite({ ...data, hora: '10:00', estado: 'cancelada' })
    await admin`update agenda_settings set buffer_minutes=15 where tenant_id=${tenant}`
    await expect(rawWrite({ ...data, hora: '10:30' })).rejects.toMatchObject({ code: '23P01' })
    await admin`update agenda_settings set buffer_minutes=0 where tenant_id=${tenant}`
    await rawWrite({ ...data, fecha: '2026-10-07', hora: '23:30', duracion_minutos: 60 })
    await expect(rawWrite({ ...data, fecha: '2026-10-08', hora: '00:00' })).rejects.toMatchObject({ code: '23P01' })
  })
  it('forzar exige admin y deja actividad, aviso configurable también deja constancia', async () => {
    const data = { personal: staff, fecha: '2026-10-05', hora: '10:00', duracion_minutos: 30, estado: 'agendada' }
    const [row] = await rawWrite(data, 'Excepción aprobada localmente')
    expect(await admin`select id from record_activities where record_id=${row!.id} and action_type='AGENDA_CONFLICT'`).toHaveLength(1)
    await expect(app.begin(async tx => {
      await tx`select set_config('app.tenant_id',${tenant},true),set_config('app.person_id','00000000-0000-0000-0000-000000000000',true),set_config('app.user_id',${staff},true),set_config('app.role_id',${staffRole},true),set_config('app.record_system','on',true),set_config('app.agenda_force_reason','No permitido',true)`
      await tx`insert into records(tenant_id,entity_id,custom_data) values (${tenant},${baseId},${tx.json(data)})`
    })).rejects.toMatchObject({ code: '23P01' })
    await admin`update agenda_settings set conflict_policy='warn' where tenant_id=${tenant}`
    const [warning] = await rawWrite(data)
    expect(await admin`select id from record_activities where record_id=${warning!.id} and action_type='AGENDA_CONFLICT'`).toHaveLength(1)
    // reserveSlot sigue siendo estricto incluso con política interna de aviso.
    await expect(actor(() => availability.reserveSlot(slot('10:00')))).rejects.toMatchObject({ statusCode: 409 })
    await admin`update agenda_settings set conflict_policy='block' where tenant_id=${tenant}`
  })
  it('duración suma servicios válidos sin exponer citas en disponibilidad', async () => {
    const [service] = await admin`insert into records(tenant_id,entity_id,custom_data) values (${tenant},(select id from entities where tenant_id=${tenant} and slug='agenda-servicios'),'{"nombre":"Servicio","duracion_minutos":45}') returning id`
    const result = await withSystemRecordAccess(() => connection.withTenant(tenant, tx => availability.availabilityInTx(tx, tenant, { from: '2026-10-05', to: '2026-10-05', personal: staff, service: service!.id + ',' + service!.id }, Date.parse('2026-10-04T12:00:00Z'))))
    expect(result.duration).toBe(90)
    expect(result.slots.every(row => row.status === 'free')).toBe(true)
    expect(JSON.stringify(result)).not.toContain(clientId)
    await expect(withSystemRecordAccess(() => connection.withTenant(tenant, tx => availability.serviceDuration(tx, tenant, randomUUID())))).rejects.toMatchObject({ statusCode: 422 })
  })
  it('reserva de sistema y creación del servidor nacen en agendada con el flujo instalado', async () => {
    const [base] = await admin`select workflow_config from entities where id=${baseId}`
    expect(base!.workflow_config).toEqual(agenda.agendaStateWorkflow)
    const reserved = await withSystemRecordAccess(() => availability.reserveSlot({ ...slot('14:00'), customData: { asunto: 'Pública futura', cliente: clientId, estado: 'terminada' } }))
    expect((reserved.customData as Record<string, unknown>).estado).toBe('agendada')
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getRouterParam', (event: { context: { params: Record<string, string> } }, name: string) => event.context.params[name])
    vi.stubGlobal('readValidatedBody', async (event: { context: { body: unknown } }, parse: (body: unknown) => unknown) => parse(event.context.body))
    vi.stubGlobal('createError', createError)
    vi.stubGlobal('setResponseStatus', () => {})
    try {
      const handler = (await import('../../server/api/records/[entity]/index.post')).default
      for (const [hora, estado] of [['15:00', undefined], ['16:00', 'terminada']] as const) {
        const event = { context: { auth, params: { entity: 'agenda-citas' }, body: { customData: { asunto: 'Servidor', cliente: clientId, personal: staff, fecha: '2026-10-05', hora, duracion_minutos: 30, ...(estado ? { estado } : {}) } } } } as unknown as Parameters<typeof handler>[0]
        const created = await actor(() => handler(event))
        expect((created.customData as Record<string, unknown>).estado).toBe('agendada')
      }
    } finally { vi.unstubAllGlobals() }
  })
})
