import 'dotenv/config'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import jwt from 'jsonwebtoken'
import { setTimeout as delay } from 'node:timers/promises'

const baseUrl = process.env.ERD122_HTTP_BASE_URL || 'http://localhost:3001'
const adminUrl = process.env.DATABASE_URL
const appUrl = process.env.APP_DATABASE_URL
if (!adminUrl || !appUrl || !['localhost', '127.0.0.1'].includes(new URL(adminUrl).hostname)
  || !['localhost', '127.0.0.1'].includes(new URL(appUrl).hostname)
  || !['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname)) throw new Error('Esta prueba solo acepta servidor y base locales')

const admin = postgres(adminUrl)
const app = postgres(appUrl)
let keyId
let createdId
let createdByApiId
let entity
let secondDentist
let originalRole
let originalBoard
let originalCalendar
let tenantId
const results = []

async function request(path, token, options = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...options,
    headers: { ...(token.startsWith('fer_live_') ? { authorization: `Bearer ${token}` } : { cookie: `erp_auth_token=${token}` }), ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers }
  })
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}

function expectStatus(result, status, label) {
  assert.equal(result.status, status, `${label}: ${JSON.stringify(result.body)}`)
  return result.body
}

try {
  const [tenant] = await admin`select id from tenants where slug = 'clinicadientitos'`
  assert.ok(tenant, 'Falta fixture clinicadientitos')
  tenantId = tenant.id
  ;[entity] = await admin`select id, board_config, calendar_config, module_kind from entities where tenant_id = ${tenantId} and slug = 'citas'`
  assert.ok(entity, 'Falta módulo citas')
  originalBoard = entity.board_config
  originalCalendar = entity.calendar_config
  const people = await admin`select u.id, u.role_id, p.email from users u join people p on p.id = u.person_id where u.tenant_id = ${tenantId} and p.email in ('luis@dientitos.test', 'mariana@dientitos.test', 'sofia@dientitos.test')`
  const byEmail = new Map(people.map(person => [person.email, person]))
  const luis = byEmail.get('luis@dientitos.test')
  secondDentist = byEmail.get('mariana@dientitos.test')
  const sofia = byEmail.get('sofia@dientitos.test')
  assert.ok(luis && secondDentist && sofia, 'Faltan tres usuarios locales')
  originalRole = secondDentist.role_id
  const [dentistRole] = await admin`select id from roles where id = ${luis.role_id} and name = 'Dentista'`
  assert.ok(dentistRole)
  const rows = await admin`select id, custom_data from records where tenant_id = ${tenantId} and entity_id = ${entity.id} and deleted_at is null`
  assert.equal(rows.length, 4, 'La fixture debe tener cuatro citas')
  const ownLuis = rows.filter(row => row.custom_data.odontologo === luis.id)
  const ownOther = rows.filter(row => row.custom_data.odontologo === secondDentist.id)
  assert.equal(ownLuis.length, 2)
  assert.equal(ownOther.length, 2)

  await admin`update users set role_id = ${dentistRole.id} where id = ${secondDentist.id}`
  await admin`update entities set board_config = ${admin.json({ ...originalBoard, enabled: true, statusField: 'estado', titleField: 'motivo' })}, calendar_config = ${admin.json({ ...originalCalendar, enabled: true, startDateField: 'fecha' })} where id = ${entity.id}`
  // El servidor puede conservar metadata previa durante 30 s.
  await delay(31_000)
  const actors = [
    { label: 'Dentista Luis', user: luis, roleId: dentistRole.id, visible: ownLuis, hidden: ownOther },
    { label: 'Dentista Mariana', user: secondDentist, roleId: dentistRole.id, visible: ownOther, hidden: ownLuis },
    { label: 'Recepcionista Sofía', user: sofia, roleId: sofia.role_id, visible: rows, hidden: [] }
  ]
  for (const actor of actors) {
    const token = jwt.sign({ sub: actor.user.id, tenantId, roleId: actor.roleId }, process.env.JWT_SECRET, { expiresIn: '5m' })
    const list = expectStatus(await request('/api/records/citas', token), 200, `${actor.label} listado`)
    assert.deepEqual(new Set(list.data.map(row => row.id)), new Set(actor.visible.map(row => row.id)))
    assert.equal(list.total, actor.visible.length)
    results.push(`${actor.label}: listado ${list.total}`)

    const own = expectStatus(await request(`/api/records/citas/${actor.visible[0].id}`, token), 200, `${actor.label} detalle propio`)
    assert.equal(own.id, actor.visible[0].id)
    if (actor.hidden.length) expectStatus(await request(`/api/records/citas/${actor.hidden[0].id}`, token), 404, `${actor.label} detalle ajeno`)

    const searchOwn = expectStatus(await request(`/api/search?q=${actor.visible[0].id}&entity=citas`, token), 200, `${actor.label} búsqueda propia`)
    assert.ok(searchOwn.results.some(result => result.id === actor.visible[0].id))
    if (actor.hidden.length) {
      const searchForeign = expectStatus(await request(`/api/search?q=${actor.hidden[0].id}&entity=citas`, token), 200, `${actor.label} búsqueda ajena`)
      assert.ok(!searchForeign.results.some(result => result.id === actor.hidden[0].id))
    }
    results.push(`${actor.label}: detalle y búsqueda`)

    const board = expectStatus(await request('/api/records/citas/board', token), 200, `${actor.label} tablero`)
    const boardRows = board.columns.flatMap(column => column.records ?? column.items ?? [])
    assert.deepEqual(new Set(boardRows.map(row => row.id)), new Set(actor.visible.map(row => row.id)))
    const calendar = expectStatus(await request('/api/records/citas/calendar?from=2020-01-01&to=2030-01-01', token), 200, `${actor.label} calendario`)
    assert.deepEqual(new Set(calendar.events.map(event => event.id)), new Set(actor.visible.map(row => row.id)))
    results.push(`${actor.label}: tablero ${boardRows.length}, calendario ${calendar.events.length}`)

    const reportDsl = { title: 'Citas', baseEntity: 'citas', columns: [{ kind: 'detalle', key: 'folio', label: 'Folio', source: { side: 'base', forwardHops: [], field: 'folio' } }] }
    const report = expectStatus(await request('/api/print-reports/preview', token, { method: 'POST', body: JSON.stringify({ dsl: reportDsl }) }), 200, `${actor.label} reporte`)
    assert.equal(report.recordCount, actor.visible.length)
    results.push(`${actor.label}: reporte ${report.recordCount}`)

    if (entity.module_kind === 'hecho') {
      const dashboard = expectStatus(await request('/api/dashboard/operational?from=2020-01-01&to=2030-01-01', token), 200, `${actor.label} tablero operativo`)
      const citas = dashboard.modules.find(module => module.slug === 'citas')
      assert.equal(citas?.total, actor.visible.length)
      results.push(`${actor.label}: tablero operativo ${citas.total}`)
    }
  }

  const luisToken = jwt.sign({ sub: luis.id, tenantId, roleId: dentistRole.id }, process.env.JWT_SECRET, { expiresIn: '5m' })
  const key = expectStatus(await request('/api/settings/api-keys', luisToken, { method: 'POST', body: JSON.stringify({ name: 'ERD-122 HTTP temporal', scopes: { citas: { read: true, create: true } } }) }), 200, 'crear API key')
  keyId = key.id
  const keyList = expectStatus(await request('/api/records/citas', key.token), 200, 'listado API key')
  assert.equal(keyList.total, 2)
  expectStatus(await request(`/api/records/citas/${ownOther[0].id}`, key.token), 404, 'detalle ajeno API key')
  results.push('API key: listado 2, detalle ajeno 404')

  const created = expectStatus(await request('/api/records/citas', luisToken, { method: 'POST', body: JSON.stringify({ customData: { ...ownLuis[0].custom_data, motivo: 'Prueba ERD-122 HTTP' } }) }), 201, 'crear cita')
  createdId = created.id
  assert.equal(created.createdBy, luis.id)
  const [stored] = await admin`select created_by from records where id = ${createdId}`
  assert.equal(stored.created_by, luis.id)
  results.push('Alta HTTP: created_by persistido')

  const createdByApi = expectStatus(await request('/api/records/citas', key.token, { method: 'POST', body: JSON.stringify({ customData: { ...ownLuis[0].custom_data, motivo: 'Prueba ERD-122 API key' } }) }), 201, 'alta API key')
  createdByApiId = createdByApi.id
  assert.equal(createdByApi.createdBy, luis.id)
  const [storedByApi] = await admin`select created_by from records where id = ${createdByApiId}`
  assert.equal(storedByApi.created_by, luis.id)
  results.push('Alta API key: created_by del propietario persistido')

  const absent = await app.begin(async tx => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', '00000000-0000-0000-0000-000000000000', true), set_config('app.role_id', '00000000-0000-0000-0000-000000000000', true), set_config('app.record_system', 'off', true)`
    return tx`select count(*)::int as count from records where tenant_id = ${tenantId} and entity_id = ${entity.id} and deleted_at is null`
  })
  assert.equal(absent[0].count, 0)
  results.push('Sin actor: 0 registros por RLS')
  console.log(results.join('\n'))
} finally {
  if (keyId && tenantId) await admin`delete from api_keys where id = ${keyId} and tenant_id = ${tenantId}`
  if (createdId) await admin`delete from records where id = ${createdId}`
  if (createdByApiId) await admin`delete from records where id = ${createdByApiId}`
  if (entity && originalBoard && originalCalendar) await admin`update entities set board_config = ${admin.json(originalBoard)}, calendar_config = ${admin.json(originalCalendar)} where id = ${entity.id}`
  if (secondDentist && originalRole) await admin`update users set role_id = ${originalRole} where id = ${secondDentist.id}`
  await app.end()
  await admin.end()
}
