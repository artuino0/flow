import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import { withRecordActor } from '../../server/utils/recordActorContext'

const tenantId = randomUUID()
let testDb: TestDb
let admin: postgres.Sql
let withTenant: typeof import('../../server/db').withTenant
let assertWritableUsers: typeof import('../../server/utils/userField').assertWritableUsers
let records: typeof import('../../server/db/schema').records
let doctor1: string
let doctor2: string
let receptionist: string
let doctorRole: string
let receptionRole: string
let appointment1: { id: string }
let appointment2: { id: string }
let child1: { id: string }
let child2: { id: string }
let appointmentEntity: string
let childEntity: string

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  await admin`INSERT INTO tenants (id, name, slug) VALUES (${tenantId}, 'Clínica', 'own-clinic')`
  const [doctor] = await admin`INSERT INTO roles (tenant_id, name, is_system) VALUES (${tenantId}, 'Doctor', false) RETURNING id`
  const [reception] = await admin`INSERT INTO roles (tenant_id, name, is_system) VALUES (${tenantId}, 'Recepción', false) RETURNING id`
  doctorRole = doctor.id
  receptionRole = reception.id
  for (const [email, role] of [['doctor1@local.test', doctorRole], ['doctor2@local.test', doctorRole], ['recepcion@local.test', receptionRole]]) {
    const [person] = await admin`INSERT INTO people (email, password_hash, full_name) VALUES (${email}, 'x', ${email}) RETURNING id`
    const [user] = await admin`INSERT INTO users (tenant_id, role_id, person_id) VALUES (${tenantId}, ${role}, ${person.id}) RETURNING id`
    if (email.startsWith('doctor1')) doctor1 = user.id
    else if (email.startsWith('doctor2')) doctor2 = user.id
    else receptionist = user.id
  }
  const [appointment] = await admin`INSERT INTO entities (tenant_id, name, slug, module_kind, detail_layout) VALUES (${tenantId}, 'Citas', 'citas', 'hecho', ${admin.json({ relations: [{ entitySlug: 'cobros', fieldName: 'cita' }] })}) RETURNING id`
  const [child] = await admin`INSERT INTO entities (tenant_id, name, slug, module_kind) VALUES (${tenantId}, 'Cobros', 'cobros', 'hecho') RETURNING id`
  appointmentEntity = appointment.id
  childEntity = child.id
  await admin`INSERT INTO entity_fields (entity_id, name, label, data_type, is_owner_field) VALUES (${appointmentEntity}, 'doctor', 'Doctor', 'user', true)`
  await admin`INSERT INTO entity_fields (entity_id, name, label, data_type, validation_rules) VALUES (${childEntity}, 'cita', 'Cita', 'relation', ${admin.json({ relationEntity: 'citas' })})`
  for (const entityId of [appointmentEntity, childEntity]) {
    await admin`INSERT INTO role_entity_permissions (role_id, entity_id, can_read, can_create, can_update, can_delete, visibility) VALUES (${doctorRole}, ${entityId}, true, true, true, true, 'own')`
    await admin`INSERT INTO role_entity_permissions (role_id, entity_id, can_read, can_create, can_update, can_delete, visibility) VALUES (${receptionRole}, ${entityId}, true, true, true, true, 'all')`
  }
  ;[appointment1] = await admin`INSERT INTO records (tenant_id, entity_id, custom_data) VALUES (${tenantId}, ${appointmentEntity}, ${admin.json({ doctor: doctor1 })}) RETURNING id`
  ;[appointment2] = await admin`INSERT INTO records (tenant_id, entity_id, custom_data) VALUES (${tenantId}, ${appointmentEntity}, ${admin.json({ doctor: doctor2 })}) RETURNING id`
  ;[child1] = await admin`INSERT INTO records (tenant_id, entity_id, custom_data) VALUES (${tenantId}, ${childEntity}, ${admin.json({ cita: appointment1.id })}) RETURNING id`
  ;[child2] = await admin`INSERT INTO records (tenant_id, entity_id, custom_data) VALUES (${tenantId}, ${childEntity}, ${admin.json({ cita: appointment2.id })}) RETURNING id`
  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ withTenant } = await import('../../server/db'))
  ;({ records } = await import('../../server/db/schema'))
  ;({ assertWritableUsers } = await import('../../server/utils/userField'))
}, 60_000)

afterAll(async () => { await admin.end(); await testDb.stop() })

describe('visibilidad de registros por responsable', () => {
  it('cada doctor ve solo sus citas e hijos; recepción ve todas', async () => {
    const ids = async (userId: string, roleId: string, entityId: string) => withRecordActor({ userId, roleId }, () => withTenant(tenantId, tx => tx.select({ id: records.id }).from(records).where(and(eq(records.tenantId, tenantId), eq(records.entityId, entityId)))))
    expect((await ids(doctor1, doctorRole, appointmentEntity)).map(row => row.id)).toEqual([appointment1.id])
    expect((await ids(doctor2, doctorRole, appointmentEntity)).map(row => row.id)).toEqual([appointment2.id])
    expect((await ids(doctor1, doctorRole, childEntity)).map(row => row.id)).toEqual([child1.id])
    expect((await ids(doctor2, doctorRole, childEntity)).map(row => row.id)).toEqual([child2.id])
    expect(await ids(receptionist, receptionRole, appointmentEntity)).toHaveLength(2)
  })

  it('el hijo hereda el acceso cuando el padre permite ver todos', async () => {
    const [role] = await admin`INSERT INTO roles (tenant_id, name, is_system) VALUES (${tenantId}, 'Auxiliar', false) RETURNING id`
    const [person] = await admin`INSERT INTO people (email, password_hash) VALUES ('auxiliar@local.test', 'x') RETURNING id`
    const [user] = await admin`INSERT INTO users (tenant_id, role_id, person_id) VALUES (${tenantId}, ${role.id}, ${person.id}) RETURNING id`
    await admin`INSERT INTO role_entity_permissions (role_id, entity_id, can_read, visibility) VALUES (${role.id}, ${appointmentEntity}, true, 'all'), (${role.id}, ${childEntity}, true, 'own')`
    const children = await withRecordActor({ userId: user.id, roleId: role.id }, () => withTenant(tenantId, tx =>
      tx.select({ id: records.id }).from(records).where(eq(records.entityId, childEntity))))
    expect(children.map(row => row.id).sort()).toEqual([child1.id, child2.id].sort())
  })

  it('bloquea lectura, edición y borrado por id ajeno en la misma política', async () => {
    await withRecordActor({ userId: doctor1, roleId: doctorRole }, () => withTenant(tenantId, async tx => {
      expect(await tx.select().from(records).where(eq(records.id, appointment2.id))).toHaveLength(0)
      expect(await tx.update(records).set({ isDirty: true }).where(eq(records.id, appointment2.id)).returning()).toHaveLength(0)
      expect(await tx.delete(records).where(eq(records.id, appointment2.id)).returning()).toHaveLength(0)
    }))
  })

  it('oculta el registro compartido en chat en tiempo real al destinatario sin acceso', async () => {
    const { sendChatMessage } = await import('../../server/utils/chat')
    const { subscribeRealtime, realtimeUserTopic } = await import('../../server/utils/realtime')
    const [conversation] = await admin`INSERT INTO chat_conversations (tenant_id, type, title, created_by) VALUES (${tenantId}, 'group', 'Equipo médico', ${doctor1}) RETURNING id`
    for (const userId of [doctor1, doctor2, receptionist]) {
      await admin`INSERT INTO chat_participants (tenant_id, conversation_id, user_id) VALUES (${tenantId}, ${conversation.id}, ${userId})`
    }
    const doctorReceived: unknown[] = []
    const receptionReceived: unknown[] = []
    const stopDoctor = subscribeRealtime(realtimeUserTopic(doctor2), event => {
      if (event.type === 'chat.message') doctorReceived.push(event.payload)
    })
    const stopReception = subscribeRealtime(realtimeUserTopic(receptionist), event => {
      if (event.type === 'chat.message') receptionReceived.push(event.payload)
    })
    try {
      await withRecordActor({ userId: doctor1, roleId: doctorRole }, () => sendChatMessage(
        { sub: doctor1, roleId: doctorRole, tenantId },
        { conversationId: conversation.id, clientMessageId: randomUUID(), body: '', sharedRecord: { entitySlug: 'citas', recordId: appointment1.id, label: 'Cita privada', url: `/registros/citas/${appointment1.id}` } }
      ))
      expect(doctorReceived).toHaveLength(1)
      expect((doctorReceived[0] as { sharedRecord: unknown }).sharedRecord).toEqual({ unavailable: true })
      expect((receptionReceived[0] as { sharedRecord: { label: string } }).sharedRecord.label).toBe('Cita privada')
    } finally { stopDoctor(); stopReception() }
  })

  it('el valor por defecto all conserva la lectura existente', async () => {
    const rows = await withTenant(tenantId, tx => tx.select().from(records).where(eq(records.entityId, appointmentEntity)))
    expect(rows).toHaveLength(2)
  })

  it('created_by habilita registros propios, pero un hijo depende estrictamente de su padre', async () => {
    const [selfCreated] = await withRecordActor({ userId: doctor1, roleId: doctorRole }, () => withTenant(tenantId, tx =>
      tx.insert(records).values({ tenantId, entityId: appointmentEntity, customData: {} }).returning({ id: records.id, createdBy: records.createdBy })))
    expect(selfCreated.createdBy).toBe(doctor1)
    expect(await withRecordActor({ userId: doctor1, roleId: doctorRole }, () => withTenant(tenantId, tx =>
      tx.select({ id: records.id }).from(records).where(eq(records.id, selfCreated.id))))).toHaveLength(1)
    expect(await withRecordActor({ userId: doctor2, roleId: doctorRole }, () => withTenant(tenantId, tx =>
      tx.select({ id: records.id }).from(records).where(eq(records.id, selfCreated.id))))).toHaveLength(0)

    const [foreignChild] = await admin`INSERT INTO records (tenant_id, entity_id, custom_data, created_by) VALUES (${tenantId}, ${childEntity}, ${admin.json({ cita: appointment2.id })}, ${doctor1}) RETURNING id`
    expect(await withRecordActor({ userId: doctor1, roleId: doctorRole }, () => withTenant(tenantId, tx =>
      tx.select({ id: records.id }).from(records).where(eq(records.id, foreignChild.id))))).toHaveLength(0)
  })

  it('valida tenant, estado, rol y asignaciones múltiples sin perder valores históricos', async () => {
    const otherTenant = randomUUID()
    await admin`INSERT INTO tenants (id, name, slug) VALUES (${otherTenant}, 'Otra clínica', 'other-clinic')`
    const [otherPerson] = await admin`INSERT INTO people (email, password_hash) VALUES ('other@local.test', 'x') RETURNING id`
    const [outsider] = await admin`INSERT INTO users (tenant_id, person_id) VALUES (${otherTenant}, ${otherPerson.id}) RETURNING id`
    const [inactivePerson] = await admin`INSERT INTO people (email, password_hash) VALUES ('inactive@local.test', 'x') RETURNING id`
    const [inactive] = await admin`INSERT INTO users (tenant_id, person_id, role_id, is_active) VALUES (${tenantId}, ${inactivePerson.id}, ${doctorRole}, false) RETURNING id`
    const field = [{ name: 'doctores', dataType: 'user', validationRules: { multiple: true, roles: ['Doctor'] } }]
    await expect(withTenant(tenantId, tx => assertWritableUsers(tx, tenantId, field, { doctores: [doctor1, doctor2] }))).resolves.toBeUndefined()
    await expect(withTenant(tenantId, tx => assertWritableUsers(tx, tenantId, field, { doctores: [doctor1, receptionist] }))).rejects.toMatchObject({ statusCode: 422 })
    await expect(withTenant(tenantId, tx => assertWritableUsers(tx, tenantId, field, { doctores: [doctor1, outsider.id] }))).rejects.toMatchObject({ statusCode: 422 })
    await expect(withTenant(tenantId, tx => assertWritableUsers(tx, tenantId, field, { doctores: [inactive.id] }))).rejects.toMatchObject({ statusCode: 422 })
    await expect(withTenant(tenantId, tx => assertWritableUsers(tx, tenantId, field, { doctores: [inactive.id] }, { doctores: [inactive.id] }))).resolves.toBeUndefined()
  })

  it('impide perfiles duplicados por usuario incluso al insertar fuera del endpoint', async () => {
    const [profileEntity] = await admin`INSERT INTO entities (tenant_id, name, slug, module_kind) VALUES (${tenantId}, 'Perfiles', 'perfiles', 'dimension') RETURNING id`
    await admin`INSERT INTO entity_fields (entity_id, name, label, data_type, validation_rules) VALUES (${profileEntity.id}, 'usuario', 'Usuario', 'user', ${admin.json({ unique: true })})`
    await admin`INSERT INTO records (tenant_id, entity_id, custom_data) VALUES (${tenantId}, ${profileEntity.id}, ${admin.json({ usuario: doctor1 })})`
    await expect(admin`INSERT INTO records (tenant_id, entity_id, custom_data) VALUES (${tenantId}, ${profileEntity.id}, ${admin.json({ usuario: doctor1 })})`).rejects.toMatchObject({ code: '23505' })
  })
})
