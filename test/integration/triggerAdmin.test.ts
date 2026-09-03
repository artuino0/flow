import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type {
  listTriggers as ListTriggers,
  getTrigger as GetTrigger,
  createTrigger as CreateTrigger,
  updateTrigger as UpdateTrigger,
  deleteTrigger as DeleteTrigger,
  createTriggerAction as CreateTriggerAction,
  updateTriggerAction as UpdateTriggerAction,
  deleteTriggerAction as DeleteTriggerAction,
  reorderTriggerActions as ReorderTriggerActions,
  listTriggerLogs as ListTriggerLogs,
  retryTriggerLogManually as RetryTriggerLogManually,
  TriggerEntityNotFoundError as TriggerEntityNotFoundErrorType,
  TriggerNotFoundError as TriggerNotFoundErrorType,
  InvalidTriggerConditionError as InvalidTriggerConditionErrorType,
  InvalidTriggerActionConfigError as InvalidTriggerActionConfigErrorType,
  InvalidTriggerActionOrderError as InvalidTriggerActionOrderErrorType,
  TriggerLogNotFoundError as TriggerLogNotFoundErrorType
} from '../../server/utils/triggerAdmin'

// HU-ERD-51: capa de administracion de triggers/trigger_actions/trigger_logs
// (server/utils/triggerAdmin.ts) - hasta esta HU (ERD-47 a ERD-50) estas tres
// tablas solo se manipulaban por SQL crudo en tests; esta es la primera
// cobertura de la capa que finalmente lo hace posible desde afuera. Mismo
// patron de import dinamico DESPUES de fijar APP_DATABASE_URL que
// triggers.test.ts/triggerActions.test.ts, y `admin.json(obj)` (nunca
// JSON.stringify) para los inserts crudos de setup - ver el comentario largo
// en triggerActions.test.ts sobre el doble-encodeo de jsonb.

const TENANT_A = randomUUID()
const TENANT_B = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let listTriggers: typeof ListTriggers
let getTrigger: typeof GetTrigger
let createTrigger: typeof CreateTrigger
let updateTrigger: typeof UpdateTrigger
let deleteTrigger: typeof DeleteTrigger
let createTriggerAction: typeof CreateTriggerAction
let updateTriggerAction: typeof UpdateTriggerAction
let deleteTriggerAction: typeof DeleteTriggerAction
let reorderTriggerActions: typeof ReorderTriggerActions
let listTriggerLogs: typeof ListTriggerLogs
let retryTriggerLogManually: typeof RetryTriggerLogManually
let TriggerEntityNotFoundError: typeof TriggerEntityNotFoundErrorType
let TriggerNotFoundError: typeof TriggerNotFoundErrorType
let InvalidTriggerConditionError: typeof InvalidTriggerConditionErrorType
let InvalidTriggerActionConfigError: typeof InvalidTriggerActionConfigErrorType
let InvalidTriggerActionOrderError: typeof InvalidTriggerActionOrderErrorType
let TriggerLogNotFoundError: typeof TriggerLogNotFoundErrorType

let entityId: string
let entitySlug: string

async function insertTriggerRow(tenantId: string, name: string, condition: unknown = {}): Promise<string> {
  const [row] = await admin`
    insert into triggers (tenant_id, entity_id, name, trigger_event, condition, is_active)
    values (${tenantId}, ${entityId}, ${name}, 'on_create', ${admin.json(condition as never)}, true)
    returning id
  `
  return row.id as string
}

async function insertLogRow(tenantId: string, triggerId: string, status: string, requestPayload: unknown = {}): Promise<string> {
  const [row] = await admin`
    insert into trigger_logs (tenant_id, trigger_id, status, attempt_count, request_payload)
    values (${tenantId}, ${triggerId}, ${status}, 1, ${admin.json(requestPayload as never)})
    returning id
  `
  return row.id as string
}

const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'test' })
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) }
}))

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)

  await admin`insert into tenants (id, name) values (${TENANT_A}, 'Acme Corp')`
  await admin`insert into tenants (id, name) values (${TENANT_B}, 'Otra Empresa')`
  const [entity] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_A}, 'Facturas', 'facturas') returning id`
  entityId = entity.id as string
  entitySlug = 'facturas'
  await admin`insert into entity_fields (entity_id, name, label, data_type) values (${entityId}, 'estado', 'Estado', 'text')`

  process.env.APP_DATABASE_URL = testDb.appUrl
  process.env.SMTP_HOST = 'smtp.test.local'
  process.env.SMTP_PORT = '587'
  process.env.SMTP_USER = 'user'
  process.env.SMTP_PASSWORD = 'pass'
  process.env.SMTP_FROM = 'ERP <no-responder@test.local>'
  ;({
    listTriggers,
    getTrigger,
    createTrigger,
    updateTrigger,
    deleteTrigger,
    createTriggerAction,
    updateTriggerAction,
    deleteTriggerAction,
    reorderTriggerActions,
    listTriggerLogs,
    retryTriggerLogManually,
    TriggerEntityNotFoundError,
    TriggerNotFoundError,
    InvalidTriggerConditionError,
    InvalidTriggerActionConfigError,
    InvalidTriggerActionOrderError,
    TriggerLogNotFoundError
  } = await import('../../server/utils/triggerAdmin'))
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

beforeEach(() => {
  sendMailMock.mockReset().mockResolvedValue({ messageId: 'test' })
})

describe('listTriggers', () => {
  it('resuelve entitySlug/entityName, actionsCount y lastLogStatus (mas reciente primero)', async () => {
    const triggerId = await insertTriggerRow(TENANT_A, 'Con acciones y logs')
    await admin`insert into trigger_actions (tenant_id, trigger_id, action_type, config, execution_order) values (${TENANT_A}, ${triggerId}, 'webhook', ${admin.json({ url: 'https://x.test' } as never)}, 0)`
    await insertLogRow(TENANT_A, triggerId, 'failed')
    await new Promise((r) => setTimeout(r, 5))
    await insertLogRow(TENANT_A, triggerId, 'success')

    const rows = await listTriggers(TENANT_A)
    const row = rows.find((r) => r.id === triggerId)!
    expect(row.entitySlug).toBe(entitySlug)
    expect(row.entityName).toBe('Facturas')
    expect(row.actionsCount).toBe(1)
    expect(row.lastLogStatus).toBe('success')
  })

  it('sin ejecuciones todavia: lastLogStatus es null', async () => {
    const triggerId = await insertTriggerRow(TENANT_A, 'Sin logs')
    const rows = await listTriggers(TENANT_A)
    expect(rows.find((r) => r.id === triggerId)?.lastLogStatus).toBeNull()
  })

  it('entityId filtra al trigger de esa entidad, y aisla por tenant', async () => {
    await insertTriggerRow(TENANT_B, 'De otro tenant')
    const rows = await listTriggers(TENANT_A, entityId)
    expect(rows.every((r) => r.entityId === entityId)).toBe(true)
    expect(rows.find((r) => r.name === 'De otro tenant')).toBeUndefined()
  })
})

describe('getTrigger', () => {
  it('devuelve el detalle con las acciones ordenadas por execution_order', async () => {
    const triggerId = await insertTriggerRow(TENANT_A, 'Con acciones ordenadas')
    await admin`insert into trigger_actions (tenant_id, trigger_id, action_type, config, execution_order) values (${TENANT_A}, ${triggerId}, 'webhook', ${admin.json({ url: 'https://b.test' } as never)}, 1)`
    await admin`insert into trigger_actions (tenant_id, trigger_id, action_type, config, execution_order) values (${TENANT_A}, ${triggerId}, 'webhook', ${admin.json({ url: 'https://a.test' } as never)}, 0)`

    const detail = await getTrigger(TENANT_A, triggerId)
    expect(detail?.actions.map((a) => (a.config as { url: string }).url)).toEqual(['https://a.test', 'https://b.test'])
  })

  it('trigger inexistente devuelve null', async () => {
    expect(await getTrigger(TENANT_A, randomUUID())).toBeNull()
  })
})

describe('createTrigger', () => {
  it('crea un trigger "en blanco" (condition {} por defecto) con isActive true', async () => {
    const created = await createTrigger(TENANT_A, { entityId, name: 'Recien creado', triggerEvent: 'on_create' })
    expect(created.isActive).toBe(true)
    expect(created.condition).toEqual({})
    expect(created.actions).toEqual([])
  })

  it('acepta una condicion valida (leaf) desde el arranque', async () => {
    const created = await createTrigger(TENANT_A, {
      entityId,
      name: 'Con condicion',
      triggerEvent: 'on_update',
      condition: { field: 'estado', operator: 'eq', value: 'vencida' }
    })
    expect(created.condition).toEqual({ field: 'estado', operator: 'eq', value: 'vencida' })
  })

  it('entidad inexistente en el tenant: TriggerEntityNotFoundError', async () => {
    await expect(createTrigger(TENANT_A, { entityId: randomUUID(), name: 'x', triggerEvent: 'on_create' })).rejects.toThrow(TriggerEntityNotFoundError)
  })

  it('condicion con forma invalida (ni {} ni un conditionNodeSchema valido): InvalidTriggerConditionError', async () => {
    await expect(
      createTrigger(TENANT_A, { entityId, name: 'x', triggerEvent: 'on_create', condition: { foo: 'bar' } })
    ).rejects.toThrow(InvalidTriggerConditionError)
  })
})

describe('updateTrigger', () => {
  it('actualiza campos parciales, incluido isActive (el toggle del listado)', async () => {
    const triggerId = await insertTriggerRow(TENANT_A, 'A actualizar')
    const updated = await updateTrigger(TENANT_A, triggerId, { isActive: false })
    expect(updated?.isActive).toBe(false)
    expect(updated?.name).toBe('A actualizar')
  })

  it('actualiza name/triggerEvent/condition juntos', async () => {
    const triggerId = await insertTriggerRow(TENANT_A, 'Original')
    const updated = await updateTrigger(TENANT_A, triggerId, {
      name: 'Renombrado',
      triggerEvent: 'on_delete',
      condition: { field: 'estado', operator: 'neq', value: 'activo' }
    })
    expect(updated?.name).toBe('Renombrado')
    expect(updated?.triggerEvent).toBe('on_delete')
    expect(updated?.condition).toEqual({ field: 'estado', operator: 'neq', value: 'activo' })
  })

  it('condicion invalida: InvalidTriggerConditionError, sin tocar la fila', async () => {
    const triggerId = await insertTriggerRow(TENANT_A, 'No se toca')
    await expect(updateTrigger(TENANT_A, triggerId, { condition: { operator: 'eq' } })).rejects.toThrow(InvalidTriggerConditionError)
    const detail = await getTrigger(TENANT_A, triggerId)
    expect(detail?.condition).toEqual({})
  })

  it('trigger inexistente devuelve null', async () => {
    expect(await updateTrigger(TENANT_A, randomUUID(), { isActive: false })).toBeNull()
  })
})

describe('deleteTrigger', () => {
  it('borra el trigger y en cascada sus trigger_actions y trigger_logs', async () => {
    const triggerId = await insertTriggerRow(TENANT_A, 'A borrar')
    await admin`insert into trigger_actions (tenant_id, trigger_id, action_type, config, execution_order) values (${TENANT_A}, ${triggerId}, 'webhook', ${admin.json({ url: 'https://x.test' } as never)}, 0)`
    await insertLogRow(TENANT_A, triggerId, 'success')

    expect(await deleteTrigger(TENANT_A, triggerId)).toBe(true)
    expect(await getTrigger(TENANT_A, triggerId)).toBeNull()
    const remainingActions = await admin`select id from trigger_actions where trigger_id = ${triggerId}`
    const remainingLogs = await admin`select id from trigger_logs where trigger_id = ${triggerId}`
    expect(remainingActions.length).toBe(0)
    expect(remainingLogs.length).toBe(0)
  })

  it('trigger inexistente devuelve false', async () => {
    expect(await deleteTrigger(TENANT_A, randomUUID())).toBe(false)
  })
})

describe('createTriggerAction', () => {
  it('valida la config contra el schema real de ejecucion (webhook)', async () => {
    const triggerId = await insertTriggerRow(TENANT_A, 'Para acciones')
    const action = await createTriggerAction(TENANT_A, triggerId, { actionType: 'webhook', config: { url: 'https://x.test' } })
    expect(action.actionType).toBe('webhook')
    expect(action.executionOrder).toBe(0)
  })

  it('sin executionOrder explicito, se agrega al final (max existente + 1)', async () => {
    const triggerId = await insertTriggerRow(TENANT_A, 'Orden automatico')
    await createTriggerAction(TENANT_A, triggerId, { actionType: 'webhook', config: { url: 'https://a.test' } })
    const second = await createTriggerAction(TENANT_A, triggerId, { actionType: 'webhook', config: { url: 'https://b.test' } })
    expect(second.executionOrder).toBe(1)
  })

  it('config invalida (webhook sin url): InvalidTriggerActionConfigError, nada se inserta', async () => {
    const triggerId = await insertTriggerRow(TENANT_A, 'Config invalida')
    await expect(createTriggerAction(TENANT_A, triggerId, { actionType: 'webhook', config: {} })).rejects.toThrow(InvalidTriggerActionConfigError)
    const detail = await getTrigger(TENANT_A, triggerId)
    expect(detail?.actions).toEqual([])
  })

  it('trigger inexistente: TriggerNotFoundError', async () => {
    await expect(createTriggerAction(TENANT_A, randomUUID(), { actionType: 'webhook', config: { url: 'https://x.test' } })).rejects.toThrow(TriggerNotFoundError)
  })
})

describe('updateTriggerAction', () => {
  it('actualiza solo config, revalidando contra el actionType YA guardado', async () => {
    const triggerId = await insertTriggerRow(TENANT_A, 'Editar accion')
    const action = await createTriggerAction(TENANT_A, triggerId, { actionType: 'webhook', config: { url: 'https://old.test' } })
    const updated = await updateTriggerAction(TENANT_A, action.id, { config: { url: 'https://new.test' } })
    expect((updated?.config as { url: string }).url).toBe('https://new.test')
  })

  it('cambiar actionType sin actualizar config incompatible: InvalidTriggerActionConfigError', async () => {
    const triggerId = await insertTriggerRow(TENANT_A, 'Cambio de tipo')
    const action = await createTriggerAction(TENANT_A, triggerId, { actionType: 'webhook', config: { url: 'https://x.test' } })
    await expect(updateTriggerAction(TENANT_A, action.id, { actionType: 'email' })).rejects.toThrow(InvalidTriggerActionConfigError)
  })

  it('accion inexistente devuelve null', async () => {
    expect(await updateTriggerAction(TENANT_A, randomUUID(), { config: { url: 'https://x.test' } })).toBeNull()
  })
})

describe('deleteTriggerAction', () => {
  it('elimina la accion', async () => {
    const triggerId = await insertTriggerRow(TENANT_A, 'Borrar accion')
    const action = await createTriggerAction(TENANT_A, triggerId, { actionType: 'webhook', config: { url: 'https://x.test' } })
    expect(await deleteTriggerAction(TENANT_A, action.id)).toBe(true)
    expect(await deleteTriggerAction(TENANT_A, action.id)).toBe(false)
  })
})

describe('reorderTriggerActions', () => {
  it('reordena y persiste el nuevo execution_order', async () => {
    const triggerId = await insertTriggerRow(TENANT_A, 'Reordenar')
    const a = await createTriggerAction(TENANT_A, triggerId, { actionType: 'webhook', config: { url: 'https://a.test' } })
    const b = await createTriggerAction(TENANT_A, triggerId, { actionType: 'webhook', config: { url: 'https://b.test' } })

    const reordered = await reorderTriggerActions(TENANT_A, triggerId, [b.id, a.id])
    expect(reordered.map((r) => r.id)).toEqual([b.id, a.id])
    expect(reordered.map((r) => r.executionOrder)).toEqual([0, 1])
  })

  it('un order que no matchea exactamente el conjunto actual: InvalidTriggerActionOrderError', async () => {
    const triggerId = await insertTriggerRow(TENANT_A, 'Orden invalido')
    const a = await createTriggerAction(TENANT_A, triggerId, { actionType: 'webhook', config: { url: 'https://a.test' } })
    await expect(reorderTriggerActions(TENANT_A, triggerId, [a.id, randomUUID()])).rejects.toThrow(InvalidTriggerActionOrderError)
  })
})

describe('listTriggerLogs', () => {
  it('lista los logs de ESE trigger, mas recientes primero', async () => {
    const triggerId = await insertTriggerRow(TENANT_A, 'Con historial')
    await insertLogRow(TENANT_A, triggerId, 'failed')
    await new Promise((r) => setTimeout(r, 5))
    const secondId = await insertLogRow(TENANT_A, triggerId, 'success')

    const logs = await listTriggerLogs(TENANT_A, triggerId)
    expect(logs[0].id).toBe(secondId)
    expect(logs[0].status).toBe('success')
  })
})

describe('retryTriggerLogManually', () => {
  it('fuerza el reintento de un log en "failed" (no solo "retrying") y termina en success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200 })
    )
    const triggerId = await insertTriggerRow(TENANT_A, 'Retry manual')
    await admin`insert into trigger_actions (tenant_id, trigger_id, action_type, config, execution_order) values (${TENANT_A}, ${triggerId}, 'webhook', ${admin.json({ url: 'https://x.test', secret: 'shh' } as never)}, 0)`
    const logId = await insertLogRow(TENANT_A, triggerId, 'failed', {
      trigger: { id: triggerId, name: 'Retry manual' },
      event: 'on_create',
      record: { id: randomUUID(), data: {} },
      firedAt: new Date().toISOString()
    })

    const result = await retryTriggerLogManually(TENANT_A, logId)
    expect(result?.status).toBe('success')
    vi.unstubAllGlobals()
  })

  it('un log ya en "success" se devuelve sin tocar (nada que reintentar)', async () => {
    const triggerId = await insertTriggerRow(TENANT_A, 'Ya exitoso')
    const logId = await insertLogRow(TENANT_A, triggerId, 'success')
    const result = await retryTriggerLogManually(TENANT_A, logId)
    expect(result?.status).toBe('success')
  })

  it('log inexistente: TriggerLogNotFoundError', async () => {
    await expect(retryTriggerLogManually(TENANT_A, randomUUID())).rejects.toThrow(TriggerLogNotFoundError)
  })
})
