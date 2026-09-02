import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import postgres from 'postgres'
import { randomUUID, createHmac } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type {
  executeTriggerActions as ExecuteTriggerActions,
  retryTriggerLog as RetryTriggerLog,
  runTriggerRetriesForTenant as RunTriggerRetriesForTenant,
  computeBackoffMs as ComputeBackoffMs
} from '../../server/utils/triggerActions'

// HU-ERD-49: ejecucion real de acciones (webhook firmado + update_field
// validado) y el job de reintentos, contra Postgres real - mismo patron de
// import dinamico DESPUES de fijar APP_DATABASE_URL que triggers.test.ts
// (ERD-48) y users.test.ts (ERD-84), porque server/db/index.ts lee la
// connection string al cargar el modulo.
//
// fetch se mockea globalmente (vi.stubGlobal) - este test NO llama ningun
// endpoint real, solo confirma que server/utils/triggerActions.ts arma y
// firma el request como se espera, y que trigger_logs/records reflejan el
// resultado correctamente.

const TENANT_A = randomUUID()
const TRIGGER_WEBHOOK_SECRET = 'un-secreto-de-pruebas'

let testDb: TestDb
let admin: postgres.Sql
let executeTriggerActions: typeof ExecuteTriggerActions
let retryTriggerLog: typeof RetryTriggerLog
let runTriggerRetriesForTenant: typeof RunTriggerRetriesForTenant
let computeBackoffMs: typeof ComputeBackoffMs

let entityId: string

// admin.json(obj) (mismo helper que moduleEntityFields.test.ts/csvImport.test.ts,
// HU-ERD-67/80) - nunca JSON.stringify(...) de antemano: si en cambio se le
// pasa un STRING (el resultado de JSON.stringify) como parametro "pelado" (con
// o sin ::jsonb en el texto de la consulta), Postgres lo resuelve como
// to_jsonb(text) (el parametro ya tiene tipo concreto "text", no el
// pseudo-tipo "unknown" de un literal SQL embebido) - eso ENVUELVE el texto
// como escalar JSON en vez de parsearlo, guardando un string doble-codificado.
// drizzle-orm disimula ese error en sus propias lecturas (su columna jsonb
// hace un JSON.parse extra si el valor le llega como string) - una lectura
// CRUDA con `admin` (sin pasar por drizzle) lo expone tal cual quedo guardado.
async function insertTrigger(name: string): Promise<string> {
  const [row] = await admin`
    insert into triggers (tenant_id, entity_id, name, trigger_event, condition, is_active)
    values (${TENANT_A}, ${entityId}, ${name}, 'on_create', ${admin.json({})}, true)
    returning id
  `
  return row.id as string
}

async function insertAction(triggerId: string, actionType: string, config: unknown, executionOrder = 0): Promise<string> {
  const [row] = await admin`
    insert into trigger_actions (tenant_id, trigger_id, action_type, config, execution_order)
    values (${TENANT_A}, ${triggerId}, ${actionType}, ${admin.json(config as never)}, ${executionOrder})
    returning id
  `
  return row.id as string
}

async function insertRecord(customData: Record<string, unknown>): Promise<string> {
  const [row] = await admin`
    insert into records (entity_id, tenant_id, custom_data) values (${entityId}, ${TENANT_A}, ${admin.json(customData as never)}) returning id
  `
  return row.id as string
}

async function getLog(triggerId: string) {
  const rows = await admin`select * from trigger_logs where trigger_id = ${triggerId} order by created_at desc limit 1`
  return rows[0] as Record<string, unknown> | undefined
}

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)

  await admin`insert into tenants (id, name) values (${TENANT_A}, 'Acme Corp')`
  const [entity] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_A}, 'Pedidos', 'pedidos') returning id`
  entityId = entity.id as string
  await admin`insert into entity_fields (entity_id, name, label, data_type) values (${entityId}, 'estado', 'Estado', 'text')`
  await admin`insert into entity_fields (entity_id, name, label, data_type) values (${entityId}, 'monto', 'Monto', 'number')`

  process.env.APP_DATABASE_URL = testDb.appUrl
  process.env.TRIGGER_WEBHOOK_DEFAULT_SECRET = TRIGGER_WEBHOOK_SECRET
  ;({ executeTriggerActions, retryTriggerLog, runTriggerRetriesForTenant, computeBackoffMs } = await import('../../server/utils/triggerActions'))
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('executeTriggerActions - accion webhook', () => {
  it('exito (2xx): trigger_logs queda success, con el status HTTP y la firma HMAC correcta', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    const triggerId = await insertTrigger('Webhook OK')
    await insertAction(triggerId, 'webhook', { url: 'https://example.com/hook' })
    const recordId = await insertRecord({ estado: 'nuevo' })

    await executeTriggerActions(TENANT_A, entityId, triggerId, 'Webhook OK', recordId, 'on_create', { estado: 'nuevo' })

    const log = await getLog(triggerId)
    expect(log?.status).toBe('success')
    expect(log?.attempt_count).toBe(1)
    expect(log?.response_status).toBe(200)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://example.com/hook')
    const sentBody = init.body as string
    const expectedSignature = createHmac('sha256', TRIGGER_WEBHOOK_SECRET).update(sentBody).digest('hex')
    expect(init.headers['X-Trigger-Signature']).toBe(`sha256=${expectedSignature}`)
    expect(JSON.parse(sentBody).record.id).toBe(recordId)
  })

  it('HTTP no-2xx: trigger_logs queda retrying (reintentable), con el status HTTP', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    const triggerId = await insertTrigger('Webhook 500')
    await insertAction(triggerId, 'webhook', { url: 'https://example.com/hook' })
    const recordId = await insertRecord({ estado: 'nuevo' })

    await executeTriggerActions(TENANT_A, entityId, triggerId, 'Webhook 500', recordId, 'on_create', { estado: 'nuevo' })

    const log = await getLog(triggerId)
    expect(log?.status).toBe('retrying')
    expect(log?.attempt_count).toBe(1)
    expect(log?.response_status).toBe(500)
  })

  it('error de red (fetch rechaza): trigger_logs queda retrying, con el mensaje de error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const triggerId = await insertTrigger('Webhook caido')
    await insertAction(triggerId, 'webhook', { url: 'https://example.com/hook' })
    const recordId = await insertRecord({ estado: 'nuevo' })

    await executeTriggerActions(TENANT_A, entityId, triggerId, 'Webhook caido', recordId, 'on_create', { estado: 'nuevo' })

    const log = await getLog(triggerId)
    expect(log?.status).toBe('retrying')
    expect(log?.last_error).toContain('ECONNREFUSED')
  })

  it('config invalida (sin url): trigger_logs queda failed (NO reintentable) - nunca manda el request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const triggerId = await insertTrigger('Webhook mal configurado')
    await insertAction(triggerId, 'webhook', { secret: 'x' })
    const recordId = await insertRecord({ estado: 'nuevo' })

    await executeTriggerActions(TENANT_A, entityId, triggerId, 'Webhook mal configurado', recordId, 'on_create', { estado: 'nuevo' })

    const log = await getLog(triggerId)
    expect(log?.status).toBe('failed')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('executeTriggerActions - accion update_field', () => {
  it('valor valido: el registro se actualiza y el log queda success', async () => {
    const triggerId = await insertTrigger('Marcar procesado')
    await insertAction(triggerId, 'update_field', { field: 'estado', value: 'procesado' })
    const recordId = await insertRecord({ estado: 'nuevo', monto: 100 })

    await executeTriggerActions(TENANT_A, entityId, triggerId, 'Marcar procesado', recordId, 'on_create', { estado: 'nuevo', monto: 100 })

    const log = await getLog(triggerId)
    expect(log?.status).toBe('success')

    const [record] = await admin`select custom_data from records where id = ${recordId}`
    expect((record.custom_data as Record<string, unknown>).estado).toBe('procesado')
    expect((record.custom_data as Record<string, unknown>).monto).toBe(100)
  })

  it('valor que NO pasa la validacion dinamica (ERD-17): el registro NO se toca, el log queda failed', async () => {
    const triggerId = await insertTrigger('Corromper monto')
    await insertAction(triggerId, 'update_field', { field: 'monto', value: 'esto-no-es-un-numero' })
    const recordId = await insertRecord({ estado: 'nuevo', monto: 100 })

    await executeTriggerActions(TENANT_A, entityId, triggerId, 'Corromper monto', recordId, 'on_create', { estado: 'nuevo', monto: 100 })

    const log = await getLog(triggerId)
    expect(log?.status).toBe('failed')

    const [record] = await admin`select custom_data from records where id = ${recordId}`
    expect((record.custom_data as Record<string, unknown>).monto).toBe(100)
  })
})

describe('executeTriggerActions - trigger sin acciones configuradas', () => {
  it('queda un log success con attempt_count 0 (nada que ejecutar todavia)', async () => {
    const triggerId = await insertTrigger('Sin acciones')
    const recordId = await insertRecord({ estado: 'nuevo' })

    await executeTriggerActions(TENANT_A, entityId, triggerId, 'Sin acciones', recordId, 'on_create', { estado: 'nuevo' })

    const log = await getLog(triggerId)
    expect(log?.status).toBe('success')
    expect(log?.attempt_count).toBe(0)
  })
})

describe('retryTriggerLog', () => {
  it('reintento exitoso: pasa de retrying a success, attempt_count sube en 1', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    const triggerId = await insertTrigger('Reintenta y sana')
    await insertAction(triggerId, 'webhook', { url: 'https://example.com/hook' })
    const recordId = await insertRecord({ estado: 'nuevo' })
    await executeTriggerActions(TENANT_A, entityId, triggerId, 'Reintenta y sana', recordId, 'on_create', { estado: 'nuevo' })
    const firstLog = await getLog(triggerId)
    expect(firstLog?.status).toBe('retrying')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
    await retryTriggerLog(TENANT_A, firstLog!.id as string)

    const retriedLog = await getLog(triggerId)
    expect(retriedLog?.status).toBe('success')
    expect(retriedLog?.attempt_count).toBe(2)
  })

  it('agota MAX_ATTEMPTS reintentando sin exito: termina en dead_letter', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    const triggerId = await insertTrigger('Nunca sana')
    await insertAction(triggerId, 'webhook', { url: 'https://example.com/hook' })
    const recordId = await insertRecord({ estado: 'nuevo' })
    await executeTriggerActions(TENANT_A, entityId, triggerId, 'Nunca sana', recordId, 'on_create', { estado: 'nuevo' })

    let log = await getLog(triggerId)
    // intento 1 ya se hizo en executeTriggerActions - reintentar 4 veces mas (2,3,4,5)
    for (let i = 0; i < 4; i++) {
      await retryTriggerLog(TENANT_A, log!.id as string)
      log = await getLog(triggerId)
    }

    expect(log?.attempt_count).toBe(5)
    expect(log?.status).toBe('dead_letter')
  })

  it('un log que ya no esta en retrying (ej. success) no se toca', async () => {
    const triggerId = await insertTrigger('Sin acciones para no tocar')
    const recordId = await insertRecord({ estado: 'nuevo' })
    await executeTriggerActions(TENANT_A, entityId, triggerId, 'Sin acciones para no tocar', recordId, 'on_create', { estado: 'nuevo' })
    const log = await getLog(triggerId)
    expect(log?.status).toBe('success')

    await retryTriggerLog(TENANT_A, log!.id as string)

    const unchanged = await getLog(triggerId)
    expect(unchanged?.status).toBe('success')
    expect(unchanged?.attempt_count).toBe(log?.attempt_count)
  })
})

describe('runTriggerRetriesForTenant', () => {
  it('solo reintenta las filas cuyo backoff ya vencio, deja intactas las que todavia no', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    const dueTrigger = await insertTrigger('Vencido')
    await insertAction(dueTrigger, 'webhook', { url: 'https://example.com/hook' })
    const dueRecord = await insertRecord({ estado: 'nuevo' })
    await executeTriggerActions(TENANT_A, entityId, dueTrigger, 'Vencido', dueRecord, 'on_create', { estado: 'nuevo' })
    const dueLog = await getLog(dueTrigger)

    const freshTrigger = await insertTrigger('Recien fallado')
    await insertAction(freshTrigger, 'webhook', { url: 'https://example.com/hook' })
    const freshRecord = await insertRecord({ estado: 'nuevo' })
    await executeTriggerActions(TENANT_A, entityId, freshTrigger, 'Recien fallado', freshRecord, 'on_create', { estado: 'nuevo' })
    const freshLog = await getLog(freshTrigger)

    // Retrocede artificialmente updated_at del log "vencido" mas alla de su backoff (2 min tras intento 1).
    const backoffMs = computeBackoffMs(1)
    await admin`update trigger_logs set updated_at = now() - interval '1 millisecond' * ${backoffMs + 1000} where id = ${dueLog!.id as string}`

    const result = await runTriggerRetriesForTenant(TENANT_A, new Date())
    expect(result.retried).toBe(1)

    const dueAfter = await getLog(dueTrigger)
    expect(dueAfter?.attempt_count).toBe(2)

    const freshAfter = await getLog(freshTrigger)
    expect(freshAfter?.attempt_count).toBe(freshLog?.attempt_count)
  })
})
