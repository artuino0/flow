import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import { withSystemRecordAccess } from '../../server/utils/recordActorContext'

let testDb: TestDb
let admin: postgres.Sql
let assertPlanCapacity: typeof import('../../server/utils/billing').assertPlanCapacity
let assertStampCapacity: typeof import('../../server/utils/billing').assertStampCapacity
let consumeStampPackage: typeof import('../../server/utils/billing').consumeStampPackage
let getPlanUsage: typeof import('../../server/utils/billing').getPlanUsage
let executeTriggerActions: typeof import('../../server/utils/triggerActions').executeTriggerActions
let enqueueEmail: typeof import('../../server/utils/jobQueue').enqueueEmail
let reserveStorage: typeof import('../../server/utils/storageUsage').reserveStorage
let saveTenantOverride: typeof import('../../server/utils/plans').saveTenantOverride
let invalidatePlanCache: typeof import('../../server/utils/plans').invalidatePlanCache
let createSite: typeof import('../../server/utils/sites').createSite
let saveSitePageDraft: typeof import('../../server/utils/sites').saveSitePageDraft
let publishSitePage: typeof import('../../server/utils/sites').publishSitePage
let submitSiteForm: typeof import('../../server/utils/siteFormSubmissions').submitSiteForm

beforeAll(async () => {
  vi.stubGlobal('createError', (options: Record<string, unknown>) => Object.assign(new Error(String(options.statusMessage ?? 'Error')), options))
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  process.env.PLAN_CACHE_TTL_MS = '0'
  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ assertPlanCapacity, assertStampCapacity, consumeStampPackage, getPlanUsage } = await import('../../server/utils/billing'))
  ;({ executeTriggerActions } = await import('../../server/utils/triggerActions'))
  ;({ enqueueEmail } = await import('../../server/utils/jobQueue'))
  ;({ reserveStorage } = await import('../../server/utils/storageUsage'))
  ;({ saveTenantOverride, invalidatePlanCache } = await import('../../server/utils/plans'))
  ;({ createSite, saveSitePageDraft, publishSitePage } = await import('../../server/utils/sites'))
  ;({ submitSiteForm } = await import('../../server/utils/siteFormSubmissions'))
}, 120_000)

afterAll(async () => {
  if (admin) await admin.end()
  if (testDb) await testDb.stop()
  delete process.env.APP_DATABASE_URL
  delete process.env.PLAN_CACHE_TTL_MS
  vi.unstubAllGlobals()
})

async function tenant(name: string) {
  const id = randomUUID()
  await admin`insert into tenants (id, name) values (${id}, ${name})`
  await getPlanUsage(id) // Starter de prueba, como una organización nueva.
  return id
}

async function setLimit(concept: string, value: number | null, planKey = 'starter') {
  await admin`insert into plan_limits (plan_id, concept, value)
    select id, ${concept}, ${value} from plans where key = ${planKey}
    on conflict (plan_id, concept) do update set value = excluded.value`
  invalidatePlanCache()
}

async function addEntity(tenantId: string, kind = 'hecho') {
  const [row] = await admin`insert into entities (tenant_id, name, slug, module_kind)
    values (${tenantId}, ${'Entidad ' + randomUUID().slice(0, 8)}, ${'ent-' + randomUUID().slice(0, 8)}, ${kind}) returning id`
  return row!.id as string
}

async function expectPlanLimit(work: Promise<unknown>, concept: string) {
  try {
    await work
    throw new Error('Se esperaba rechazo plan_limit')
  } catch (error) {
    expect(error).toMatchObject({ data: { code: 'plan_limit', concept } })
  }
}

describe('aplicación de límites por concepto con PostgreSQL real', () => {
  it('usuarios: permite justo debajo del tope y bloquea una invitación al llegar al tope', async () => {
    await setLimit('users', 1)
    const id = await tenant('ERD100 users')
    await assertPlanCapacity(id, 'users')
    const personId = randomUUID()
    await admin`insert into people (id, email, password_hash) values (${personId}, ${personId + '@test.invalid'}, 'hash')`
    await admin`insert into users (tenant_id, person_id, is_active, invitation_token_hash, invitation_expires_at)
      values (${id}, ${personId}, false, 'pending-hash', now() + interval '1 day')`
    await expectPlanLimit(assertPlanCapacity(id, 'users'), 'users')
  })

  it('módulos: bloquea el módulo no catálogo y el catálogo no consume cuota', async () => {
    await setLimit('modules', 1)
    const id = await tenant('ERD100 modules')
    await addEntity(id, 'dimension')
    await assertPlanCapacity(id, 'modules')
    await addEntity(id, 'hecho')
    await expectPlanLimit(assertPlanCapacity(id, 'modules'), 'modules')
  })

  it('flujos activos: bloquea activar otro flujo al tope', async () => {
    await setLimit('activeFlows', 1)
    const id = await tenant('ERD100 flows')
    const entityId = await addEntity(id)
    await assertPlanCapacity(id, 'activeFlows')
    await admin`insert into triggers (tenant_id, entity_id, name, trigger_event, is_active)
      values (${id}, ${entityId}, 'Flujo activo', 'on_create', true)`
    await expectPlanLimit(assertPlanCapacity(id, 'activeFlows'), 'activeFlows')
  })

  it('ejecuciones: registra en trigger_logs una ejecución excedida y conserva el evento', async () => {
    await setLimit('executions', 0)
    const id = await tenant('ERD100 executions')
    const entityId = await addEntity(id)
    const [trigger] = await admin`insert into triggers (tenant_id, entity_id, name, trigger_event)
      values (${id}, ${entityId}, 'Flujo limitado', 'on_create') returning id`
    await executeTriggerActions(id, entityId, trigger!.id, 'Flujo limitado', null as unknown as string, 'on_create', { prueba: true })
    const [log] = await admin`select status, last_error, request_payload from trigger_logs where tenant_id = ${id}`
    expect(log).toMatchObject({ status: 'failed' })
    expect(log!.last_error).toMatch(/límite del plan/i)
    expect(log!.request_payload).toMatchObject({ event: 'on_create', record: { data: { prueba: true } } })
  })

  it('correos: deja el correo excedido en dead con motivo', async () => {
    await setLimit('emails', 0)
    const id = await tenant('ERD100 emails')
    const jobId = await enqueueEmail(id, { to: 'destino@example.test', subject: 'Prueba', html: '<p>hola</p>' })
    const [job] = await admin`select status, last_error from job_queue where id = ${jobId}`
    expect(job).toMatchObject({ status: 'dead' })
    expect(job!.last_error).toContain('cuota mensual de correos')
  })

  it('timbres: usa incluidos primero, luego consume paquete y bloquea sin saldo', async () => {
    await setLimit('stamps', 1)
    const id = await tenant('ERD100 stamps')
    const [series] = await admin`insert into cfdi_series (tenant_id, serie, tipo_comprobante, lugar_expedicion)
      values (${id}, 'T', 'I', '06000') returning id`
    await assertStampCapacity(id) // El timbre incluido todavía está disponible.
    await admin`insert into cfdi_documents (tenant_id, serie_id, tipo, estado, fecha_timbrado)
      values (${id}, ${series!.id}, 'I', 'timbrada', now())`
    await admin`insert into stamp_packages (tenant_id, quantity, remaining, origin) values (${id}, 1, 1, 'test')`
    await assertStampCapacity(id) // Límite incluido agotado, paquete disponible.
    await admin`insert into cfdi_documents (tenant_id, serie_id, tipo, estado, fecha_timbrado)
      values (${id}, ${series!.id}, 'I', 'timbrada', now())`
    expect(await consumeStampPackage(id)).toBe(true)
    const [packageRow] = await admin`select remaining from stamp_packages where tenant_id = ${id}`
    expect(packageRow!.remaining).toBe(0)
    await expectPlanLimit(assertStampCapacity(id), 'stamps')
  })

  it('almacenamiento: permite la subida justo al límite y rechaza el siguiente byte', async () => {
    await setLimit('storageBytes', 10)
    const id = await tenant('ERD100 storage')
    await admin`update tenants set storage_limit_bytes = 10, storage_used_bytes = 8 where id = ${id}`
    await assertPlanCapacity(id, 'storageBytes', 2)
    await reserveStorage(id, 2)
    await expectPlanLimit(assertPlanCapacity(id, 'storageBytes', 1), 'storageBytes')
  })

  it('sitios: permite debajo del límite y bloquea crear otro al tope', async () => {
    await setLimit('sites', 1)
    const id = await tenant('ERD100 sites')
    await assertPlanCapacity(id, 'sites')
    const [site] = await admin`insert into sites (tenant_id, name, slug) values (${id}, 'Sitio test', ${'site-' + randomUUID().slice(0, 8)}) returning id`
    await expectPlanLimit(assertPlanCapacity(id, 'sites'), 'sites')
    expect(site!.id).toBeTruthy()
  })

  it('páginas: permite debajo del límite y bloquea crear otra al tope', async () => {
    await setLimit('pages', 1)
    const id = await tenant('ERD100 pages')
    const [site] = await admin`insert into sites (tenant_id, name, slug) values (${id}, 'Sitio páginas', ${'pages-' + randomUUID().slice(0, 8)}) returning id`
    await assertPlanCapacity(id, 'pages')
    const [page] = await admin`insert into site_pages (tenant_id, site_id, path, title) values (${id}, ${site!.id}, '/', 'Inicio') returning id`
    await expectPlanLimit(assertPlanCapacity(id, 'pages'), 'pages')
    expect(page!.id).toBeTruthy()
  })

  it('formularios: permite debajo del límite y bloquea conectar otro al tope', async () => {
    await setLimit('forms', 1)
    const id = await tenant('ERD100 forms')
    const entityId = await addEntity(id)
    const [site] = await admin`insert into sites (tenant_id, name, slug) values (${id}, 'Sitio formularios', ${'forms-' + randomUUID().slice(0, 8)}) returning id`
    const [page] = await admin`insert into site_pages (tenant_id, site_id, path, title) values (${id}, ${site!.id}, '/', 'Inicio') returning id`
    await assertPlanCapacity(id, 'forms')
    await admin`insert into site_form_connections (tenant_id, site_id, page_id, form_key, entity_id)
      values (${id}, ${site!.id}, ${page!.id}, 'contacto', ${entityId})`
    await expectPlanLimit(assertPlanCapacity(id, 'forms'), 'forms')
  })

  it('envíos de formulario: bloquea el envío público excedido', async () => {
    await setLimit('formSubmissions', 1)
    const id = await tenant('ERD100 form submissions')
    const site = await createSite(id, null as unknown as string, { name: 'Sitio público', slug: 'sitio-publico' })
    const page = site.pageCount === 1
      ? (await admin`select id from site_pages where site_id = ${site.id} limit 1`)[0]
      : null
    await saveSitePageDraft(id, null as unknown as string, site.id, page!.id, {
      title: 'Inicio', path: '/', html: '<form data-flow-form="lead"></form>', css: ''
    })
    await publishSitePage(id, null as unknown as string, site.id, page!.id)
    const entityId = await addEntity(id)
    await admin`insert into site_form_connections (tenant_id, site_id, page_id, form_key, entity_id)
      values (${id}, ${site.id}, ${page!.id}, 'lead', ${entityId})`
    const submission = {
      siteId: site.id, pageId: page!.id, formKey: 'lead', payload: {},
      origin: { domain: 'example.test', path: '/', referrer: null, userAgent: null, utm: {}, capturedAt: new Date().toISOString() }
    }
    await assertPlanCapacity(id, 'formSubmissions')
    await withSystemRecordAccess(() => submitSiteForm(submission))
    await expectPlanLimit(withSystemRecordAccess(() => submitSiteForm(submission)), 'formSubmissions')
    const [{ count }] = await admin`select count(*)::int as count from site_form_submissions where tenant_id = ${id}`
    expect(count).toBe(1)
  })

  it('Empresarial: admite todos los conceptos con límites ilimitados', async () => {
    const id = await tenant('ERD100 enterprise')
    const [enterprise] = await admin`select id from plans where key = 'empresarial'`
    await admin`update tenant_subscriptions set plan_id = ${enterprise!.id} where tenant_id = ${id}`
    for (const concept of ['users', 'modules', 'activeFlows', 'executions', 'emails', 'storageBytes', 'stamps', 'sites', 'pages', 'forms', 'formSubmissions'] as const) {
      await assertPlanCapacity(id, concept, 100_000)
    }
  })

  it('override: un acuerdo vigente eleva el límite y permite lo que Starter bloquearía', async () => {
    await setLimit('modules', 0)
    const id = await tenant('ERD100 override')
    await expectPlanLimit(assertPlanCapacity(id, 'modules'), 'modules')
    await saveTenantOverride({ tenantId: id, concept: 'modules', value: 1, reason: 'Acuerdo de prueba', validFrom: null, validUntil: null })
    await assertPlanCapacity(id, 'modules')
  })
})
