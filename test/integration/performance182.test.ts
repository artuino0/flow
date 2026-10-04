import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import * as h3 from 'h3'
import { writeFileSync } from 'node:fs'
import baseline from '../../scripts/performance182-baseline.json'
import { generate, generateSecret } from 'otplib'
import { createTestDb, type TestDb } from '../setup/testDb'
import { measureLocalDatabase } from '../../scripts/performanceDb182'
import { withRecordActor } from '../../server/utils/recordActorContext'
import { instrumentDatabase, newRequestPerformance, performanceScope } from '../../server/utils/requestPerformance'

vi.mock('../../server/utils/mailer', () => ({ sendPlainEmail: vi.fn(), sendVerificationEmail: vi.fn() }))
vi.mock('../../server/utils/triggers', () => ({ fireTriggersForRecord: vi.fn() }))
const tenant = randomUUID(), entity = randomUUID(), target = randomUUID(), recordId = randomUUID(), relatedId = randomUUID()
const secret = 'local-performance-fixture-182-secret', password = 'Local-fixture-182', email = 'performance182@test.local'
let database: TestDb, admin: postgres.Sql, connection: typeof import('../../server/db'), cache: typeof import('../../server/utils/shortCache')
let token: string, user: string, role: string, person: string, totpSecret: string
let restore: (() => void) | undefined
type Measurement = { flow: string; queries: number; trips: number; ms: number; bytes: number }
let current: Measurement | undefined
const results: Measurement[] = []
const statements = new Map<string, { parameters: readonly unknown[]; count: number }>()
type Handler = (event: h3.H3Event) => unknown
let middleware: Handler
const handlers = new Map<string, Handler>()
function event(url: string, params: Record<string, string> = {}, body?: unknown) {
  const request = new IncomingMessage(new Socket()); request.url = url; request.method = body ? 'POST' : 'GET'
  request.headers = { host: 'localhost:3000', authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  if (body) { const json = JSON.stringify(body); request.headers['content-length'] = String(Buffer.byteLength(json)); request.push(json) }; request.push(null)
  const result = h3.createEvent(request, new ServerResponse(request)); result.context.params = params
  return result
}
beforeAll(async () => {
  process.env.SESSION_CACHE_TTL_MS = '10000'; process.env.ACCESS_CACHE_TTL_MS = '5000'; process.env.METADATA_CACHE_TTL_MS = '30000'
  database = await createTestDb(); admin = postgres(database.adminUrl, { onnotice: () => {} })
  process.env.APP_DATABASE_URL = database.appUrl; process.env.APP_BASE_URL = 'http://localhost:3000'; process.env.JWT_SECRET = secret
  for (const [key, value] of Object.entries(h3)) vi.stubGlobal(key, value)
  vi.stubGlobal('useRuntimeConfig', () => ({ jwtSecret: secret }))
  vi.useFakeTimers({toFake:['Date']}); vi.setSystemTime(Date.now()+60_000)
  const auth = await import('../../server/utils/auth')
  await admin`insert into tenants(id,name,slug,onboarding_status) values (${tenant},'Medición local 182',${'perf-' + tenant},'complete')`
  ;[{ id: role }] = await admin`insert into roles(tenant_id,name,is_system) values (${tenant},'Administrador',true) returning id` as unknown as [{ id: string }]
  ;[{ id: person }] = await admin`insert into people(email,password_hash,email_verified_at) values (${email},${await auth.hashPassword(password)},now()) returning id` as unknown as [{ id: string }]
  ;[{ id: user }] = await admin`insert into users(tenant_id,person_id,role_id,is_active) values (${tenant},${person},${role},true) returning id` as unknown as [{ id: string }]
  await admin`insert into entities(id,tenant_id,name,slug) values (${entity},${tenant},'Pedidos','pedidos'),(${target},${tenant},'Clientes','clientes')`
  await admin`insert into entity_fields(entity_id,name,label,data_type,validation_rules) values (${entity},'nombre','Nombre','text','{}'),(${entity},'cliente','Cliente','relation','{"relationEntity":"clientes"}'),(${entity},'cliente_alterno','Cliente alterno','relation','{"relationEntity":"clientes"}'),(${target},'nombre','Nombre','text','{}')`
  await admin`insert into role_entity_permissions(role_id,entity_id,can_read,can_create,can_update,can_delete) values (${role},${entity},true,true,true,true),(${role},${target},true,true,true,true)`
  await admin`insert into records(id,tenant_id,entity_id,custom_data,is_dirty) values (${relatedId},${tenant},${target},'{"nombre":"Cliente local"}',false),(${recordId},${tenant},${entity},${JSON.stringify({ nombre: 'Pedido local', cliente: relatedId, cliente_alterno: relatedId })}::jsonb,false)`
  await admin`insert into records(tenant_id,entity_id,custom_data,is_dirty) select ${tenant},${entity},jsonb_build_object('nombre','Pedido '||n,'cliente',${relatedId}::text,'cliente_alterno',${relatedId}::text),false from generate_series(1,1000) n`
  connection = await import('../../server/db'); cache = await import('../../server/utils/shortCache')
  // Comparación de trabajo por petición, sin mezclar el catálogo de tipos que
  // postgres.js lee al abrir conexiones nuevas con consultas de negocio.
  const {sql}=await import('drizzle-orm')
  await Promise.all(Array.from({length:4},()=>connection.db.execute(sql`select pg_sleep(0.01)`)))
  if (process.env.PERF182_STAGE === 'before') instrumentDatabase(connection.client)
  await (await import('../../server/utils/agendaTemplate')).installAgendaTemplate(tenant)
  const [{ id: sid }] = await admin`insert into auth_sessions(tenant_id,user_id,expires_at) values (${tenant},${user},now()+interval '7 days') returning id`
  token = auth.signAuthToken({ sub: user, tenantId: tenant, roleId: role, sid }, secret)
  totpSecret = generateSecret()
  middleware = (await import('../../server/middleware/auth')).default
  for (const [key, importer] of [
    ['login', () => import('../../server/api/auth/login.post')], ['totp', () => import('../../server/api/auth/login/totp.post')],
    ['menu', () => import('../../server/api/nav/entities.get')], ['dashboard', () => import('../../server/api/dashboard/metrics.get')], ['operational', () => import('../../server/api/dashboard/operational.get')],
    ['modules', () => import('../../server/api/entities/index.get')], ['list', () => import('../../server/api/records/[entity]/index.get')],
    ['detail', () => import('../../server/api/records/[entity]/[id].get')], ['fields', () => import('../../server/api/entities/[id]/fields.get')],
    ['settings', () => import('../../server/api/tenant/index.get')], ['sites', () => import('../../server/api/sites/index.get')],
    ['agenda', () => import('../../server/api/agenda/availability.get')]
  ] as const) handlers.set(key, (await importer()).default)
  restore = measureLocalDatabase(connection.client, () => Boolean(current), Number(process.env.PERF182_LATENCY_MS ?? 0), (query, parameters) => {
    current!.trips++; if (!/^\s*(begin|commit|rollback|savepoint|release)\b/i.test(query)) current!.queries++
    const previous = statements.get(query); statements.set(query, { parameters, count: (previous?.count ?? 0) + 1 })
  })
}, 90000)

it('instrumentación HTTP compilada y JS inicial de login/Tablero, en loopback y sin navegador', async () => {
  if (!process.env.PERF182_HTTP_SMOKE) return // El arnés explícito requiere build; la suite general no depende de un artefacto.
  await admin`update people set totp_enabled=false where id=${person}`
  const {smokePerformance182}=await import('../../scripts/smokePerformance182.mjs')
  const result=await smokePerformance182(process.cwd(),database.appUrl,{email,password},secret)
  writeFileSync('C:/desarrollo/ERP-Dinamico/DOCS/tareas/erd182-http-smoke.json',JSON.stringify(result,null,2))
},90000)
afterAll(async () => { restore?.(); await connection?.client.end(); await admin?.end(); await database?.stop(); vi.unstubAllGlobals(); delete process.env.APP_DATABASE_URL })
afterEach(() => vi.useRealTimers())
async function measure(flow: string, request: h3.H3Event, handler?: Handler, auth = true) {
  current = { flow, queries: 0, trips: 0, ms: 0, bytes: 0 }; const start = performance.now()
  const metrics = newRequestPerformance()
  const result = await performanceScope(metrics, () => withRecordActor({ userId: user, roleId: role }, async () => { if (auth) await middleware(request); return handler ? await handler(request) : { ok: true } }))
  expect(metrics.queries,flow).toBe(current.queries); expect(metrics.trips,flow).toBe(current.trips)
  current.ms = Math.round(performance.now() - start); current.bytes = Buffer.byteLength(JSON.stringify(result)); results.push(current); current = undefined
  return result
}
it('mide handlers reales, viajes, respuestas y diez planes locales; impide regresión de N+1', async () => {
  // La edad lógica de los cachés es idéntica antes/después; la latencia artificial
  // no debe convertir el ensayo de N+1 en una prueba accidental de expiración.
  cache.sessionCache.clear(); cache.accessCache.clear(); cache.metadataCache.clear()
  await measure('login-password', event('/api/auth/login', {}, { email, password }), handlers.get('login'), false)
  await admin`update people set totp_enabled=true,totp_secret=${totpSecret} where id=${person}`
  const pending = await measure('login-totp-password', event('/api/auth/login', {}, { email, password }), handlers.get('login'), false) as { tempToken: string }
  await measure('login-totp-code', event('/api/auth/login/totp', {}, { tempToken: pending.tempToken, code: await generate({ secret: totpSecret }) }), handlers.get('totp'), false)
  await measure('session-cold', event('/api/auth/me'))
  await measure('session-warm', event('/api/auth/me'))
  for (const [flow, url, key, params] of [
    ['menu', '/api/nav/entities', 'menu', {}], ['dashboard', '/api/dashboard/metrics', 'dashboard', {}], ['dashboard-operational', '/api/dashboard/operational', 'operational', {}], ['modules', '/api/entities', 'modules', {}],
    ['records-list', '/api/records/pedidos?page=1&pageSize=20', 'list', { entity: 'pedidos' }],
    ['record-detail', `/api/records/pedidos/${recordId}`, 'detail', { entity: 'pedidos', id: recordId }],
    ['form-new', '/api/entities/pedidos/fields', 'fields', { id: 'pedidos' }], ['form-edit', '/api/entities/pedidos/fields', 'fields', { id: 'pedidos' }],
    ['settings', '/api/tenant', 'settings', {}], ['sites', '/api/sites', 'sites', {}], ['agenda-slots', '/api/agenda/availability?from=2026-10-05&to=2026-10-05', 'agenda', {}]
  ] as const) {
    await measure(flow, event(url, params), handlers.get(key))
    if (flow==='records-list') await measure('records-list-100',event('/api/records/pedidos?pageSize=100',{entity:'pedidos'}),handlers.get('list'))
  }
  const first = results.find(row => row.flow === 'records-list')!
  expect(results.find(row=>row.flow==='records-list-100')!.trips).toBeLessThanOrEqual(first.trips)
  expect(first.bytes).toBeGreaterThan(1000)
  if (process.env.PERF182_STAGE !== 'before') {
    for (const row of results) {
      const previous=(baseline.trips as Record<string,number>)[row.flow]
      expect(row.trips, `Tope de viajes de ${row.flow}`).toBeLessThanOrEqual(previous)
      if (['login-password','session-cold','session-warm','menu','dashboard','dashboard-operational','records-list','record-detail'].includes(row.flow)) expect(row.trips).toBeLessThan(previous)
    }
  }
  // SQL real capturado con parámetros exclusivamente sintéticos, EXPLAIN sin ejecutar escrituras.
  const plans: { sql: string; count: number; plan: unknown }[] = []
  for (const [query, observation] of [...statements].filter(([query]) => /^\s*select\b/i.test(query) && !query.includes('set_config')).sort((a,b) => b[1].count-a[1].count).slice(0,10)) {
    // El plan usa rol app y contexto real en la misma conexión, nunca bypass RLS.
    const explained = await connection.client.begin(async scope => {
      await scope`select set_config('app.tenant_id', ${tenant}, true), set_config('app.person_id', ${'00000000-0000-0000-0000-000000000000'},true), set_config('app.user_id',${user},true), set_config('app.role_id',${role},true), set_config('app.record_system','off',true)`
      return scope.unsafe(`EXPLAIN (FORMAT JSON) ${query}`, observation.parameters as Parameters<typeof scope.unsafe>[1])
    })
    plans.push({ sql: query, count: observation.count, plan: explained })
  }
  expect(plans).toHaveLength(10)
  if (process.env.PERF182_STAGE) {
    const docs = 'C:/desarrollo/ERP-Dinamico/DOCS/tareas'
    writeFileSync(`${docs}/erd182-measure-${process.env.PERF182_STAGE}.json`, JSON.stringify({ latencyMs: Number(process.env.PERF182_LATENCY_MS), fixture: '1001 pedidos, 2 relaciones al mismo cliente; caches por defecto', results, plans }, null, 2))
  }
}, 90000)

it('cachés reales aíslan tenant/rol e invalidan navegación, campos, módulos y ajustes en la siguiente petición', async () => {
  cache.metadataCache.clear(); cache.accessCache.clear()
  const modules=await import('../../server/utils/moduleEntities'), schema=await import('../../server/utils/dynamicSchema'), permissions=await import('../../server/utils/rolePermissions')
  const [otherRole]=await admin`insert into roles(tenant_id,name,is_system) values (${tenant},'Sin permisos',false) returning id`
  expect((await modules.listVisibleEntities(tenant,role)).some(item=>item.id===entity)).toBe(true)
  const copy=await modules.listVisibleEntities(tenant,role); copy[0]!.name='Contaminado'
  expect((await modules.listVisibleEntities(tenant,role))[0]!.name).not.toBe('Contaminado')
  expect(await modules.listVisibleEntities(tenant,otherRole!.id)).toEqual([])
  expect(await modules.listVisibleEntities(randomUUID(),role)).toEqual([])
  await permissions.setRolePermissions(tenant,role,[{ entityId:entity,canRead:false,canCreate:false,canUpdate:false,canDelete:false }])
  expect((await modules.listVisibleEntities(tenant,role)).some(item=>item.id===entity)).toBe(false)
  await permissions.setRolePermissions(tenant,role,[{ entityId:entity,canRead:true,canCreate:true,canUpdate:true,canDelete:true }])
  const original=await schema.getEntityZodSchema(tenant,entity)
  const fields=await import('../../server/utils/moduleEntityFields')
  await withRecordActor({ userId:user,roleId:role },()=>fields.createEntityField(tenant,entity,{ name:'obligatorio',label:'Obligatorio',dataType:'text',isRequired:true,validationRules:{} }))
  expect(original.safeParse({nombre:'local'}).success).toBe(true)
  expect((await schema.getEntityZodSchema(tenant,entity)).safeParse({nombre:'local'}).success).toBe(false)
  await modules.updateEntity(tenant,entity,{name:'Pedidos actualizados'} as Parameters<typeof modules.updateEntity>[2])
  expect((await modules.listVisibleEntities(tenant,role)).find(item=>item.id===entity)?.name).toBe('Pedidos actualizados')
  const first=event('/api/tenant'); first.context.auth={ sub:user,tenantId:tenant,roleId:role }
  const settings=handlers.get('settings')!
  await settings(first)
  const update=(await import('../../server/api/tenant/index.put')).default
  const request=event('/api/tenant',{}, {name:'Organización actualizada'}); request.node.req.method='PUT'; request.context.auth=first.context.auth
  await update(request)
  expect(await settings(first)).toMatchObject({name:'Organización actualizada'})
})

it('medición de consultas y fronteras permanece separada en transacciones concurrentes reales', async () => {
  const a=newRequestPerformance(), b=newRequestPerformance(), {sql}=await import('drizzle-orm')
  await Promise.all([performanceScope(a,()=>connection.withTenant(tenant,tx=>tx.execute(sql`select 1`))),performanceScope(b,()=>connection.withTenant(tenant,tx=>tx.execute(sql`select 2`)))])
  expect(a.queries).toBe(2); expect(b.queries).toBe(2); expect(a.trips).toBe(4); expect(b.trips).toBe(4)
  expect(a.databaseMs).toBeGreaterThan(0); expect(b.databaseMs).toBeGreaterThan(0)
})
