import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type {
  createEntityField as CreateEntityField,
  updateEntityField as UpdateEntityField,
  deleteEntityField as DeleteEntityField,
  DuplicateFieldNameError as DuplicateFieldNameErrorType,
  EntityNotFoundError as EntityNotFoundErrorType,
  InvalidValidationRulesError as InvalidValidationRulesErrorType
} from '../../server/utils/moduleEntityFields'

// HU-ERD-67: prueba server/utils/moduleEntityFields.ts contra un Postgres
// real (embedded-postgres, misma infraestructura de HU-ERD-29) - en
// particular que entity_fields NO tiene tenant_id/RLS propio (se resuelve via
// la entity dueña, ver comentario en moduleEntityFields.ts), que el snapshot
// en entity_field_history solo se escribe cuando cambia dataType/
// validationRules/isRequired (no en un simple rename de label), y que el
// trigger de Postgres de la migracion 0011 (ERD-18) efectivamente marca
// records.is_dirty=true sin que este codigo tenga que replicar esa logica.

const TENANT_A = randomUUID()
const TENANT_B = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let createEntityField: typeof CreateEntityField
let updateEntityField: typeof UpdateEntityField
let deleteEntityField: typeof DeleteEntityField
let DuplicateFieldNameError: typeof DuplicateFieldNameErrorType
let EntityNotFoundError: typeof EntityNotFoundErrorType
let InvalidValidationRulesError: typeof InvalidValidationRulesErrorType

let entityA: string
let entityB: string

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)

  await admin`insert into tenants (id, name) values (${TENANT_A}, 'Tenant A')`
  const [entA] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_A}, 'Clientes', 'clientes') returning id`
  entityA = entA.id as string

  await admin`insert into tenants (id, name) values (${TENANT_B}, 'Tenant B')`
  const [entB] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_B}, 'Clientes', 'clientes') returning id`
  entityB = entB.id as string

  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ createEntityField, updateEntityField, deleteEntityField, DuplicateFieldNameError, EntityNotFoundError, InvalidValidationRulesError } =
    await import('../../server/utils/moduleEntityFields'))
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

describe('moduleEntityFields (Postgres real)', () => {
  it('createEntityField crea el campo con validationRules/isRequired por default', async () => {
    const field = await createEntityField(TENANT_A, entityA, {
      name: 'nombre',
      label: 'Nombre',
      dataType: 'text',
      validationRules: {},
      isRequired: true
    })
    expect(field).toMatchObject({ name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: true })
  })

  // HU-ERD-68: confirma que getValidationRulesSchema (dynamicSchema.ts) y
  // createEntityField estan cableados de punta a punta para los 3 dataType
  // nuevos - buildFieldType() ya se prueba aislado en test/unit/dynamicSchema.test.ts.
  it('createEntityField acepta los dataType nuevos de HU-ERD-68 (tabla/select/multiselect) con su validationRules propio', async () => {
    const tabla = await createEntityField(TENANT_A, entityA, {
      name: 'items',
      label: 'Items',
      dataType: 'tabla',
      validationRules: { columns: [{ name: 'cantidad', label: 'Cantidad', type: 'number' }] },
      isRequired: false
    })
    expect(tabla.dataType).toBe('tabla')

    const select = await createEntityField(TENANT_A, entityA, {
      name: 'estado',
      label: 'Estado',
      dataType: 'select',
      validationRules: { options: [{ value: 'activo', label: 'Activo' }] },
      isRequired: false
    })
    expect(select.dataType).toBe('select')

    const multiselect = await createEntityField(TENANT_A, entityA, {
      name: 'tags',
      label: 'Tags',
      dataType: 'multiselect',
      validationRules: { options: [{ value: 'urgente', label: 'Urgente' }] },
      isRequired: false
    })
    expect(multiselect.dataType).toBe('multiselect')
  })

  it('createEntityField rechaza "tabla" sin columns y "select" sin options', async () => {
    await expect(
      createEntityField(TENANT_A, entityA, { name: 'items_invalido', label: 'Items', dataType: 'tabla', validationRules: {}, isRequired: false })
    ).rejects.toBeInstanceOf(InvalidValidationRulesError)

    await expect(
      createEntityField(TENANT_A, entityA, { name: 'estado_invalido', label: 'Estado', dataType: 'select', validationRules: {}, isRequired: false })
    ).rejects.toBeInstanceOf(InvalidValidationRulesError)
  })

  it('createEntityField rechaza validationRules que no calzan con el dataType', async () => {
    await expect(
      createEntityField(TENANT_A, entityA, { name: 'edad', label: 'Edad', dataType: 'number', validationRules: { minLength: 3 }, isRequired: false })
    ).rejects.toBeInstanceOf(InvalidValidationRulesError)
  })

  // HU-ERD-71: el editor de opciones (Select/Multiselect) y el editor de
  // columnas (Tabla) construidos en el frontend dependen de que el backend
  // rechace duplicados - "value" es la clave real que se guarda en
  // custom_data (z.enum), y "name" de columna es la clave del objeto de
  // fila (buildFieldType, caso 'tabla') - un duplicado silencioso ahi
  // pisaria datos sin que nadie lo note.
  it('createEntityField rechaza "value" duplicado entre opciones de select/multiselect', async () => {
    await expect(
      createEntityField(TENANT_A, entityA, {
        name: 'prioridad_invalida',
        label: 'Prioridad',
        dataType: 'select',
        validationRules: {
          options: [
            { value: 'alta', label: 'Alta' },
            { value: 'alta', label: 'Alta (duplicado)' }
          ]
        },
        isRequired: false
      })
    ).rejects.toBeInstanceOf(InvalidValidationRulesError)
  })

  it('createEntityField rechaza nombre de columna duplicado dentro del mismo campo tabla', async () => {
    await expect(
      createEntityField(TENANT_A, entityA, {
        name: 'items_duplicado',
        label: 'Items',
        dataType: 'tabla',
        validationRules: {
          columns: [
            { name: 'cantidad', label: 'Cantidad', type: 'number' },
            { name: 'cantidad', label: 'Cantidad (otra vez)', type: 'text' }
          ]
        },
        isRequired: false
      })
    ).rejects.toBeInstanceOf(InvalidValidationRulesError)
  })

  it('createEntityField acepta una columna tabla tipo relación con copyFrom/editable en otra columna (HU-ERD-71)', async () => {
    const field = await createEntityField(TENANT_A, entityA, {
      name: 'lineas',
      label: 'Líneas',
      dataType: 'tabla',
      validationRules: {
        columns: [
          { name: 'producto_id', label: 'Producto', type: 'relation', relationEntity: 'productos' },
          { name: 'precio_unitario', label: 'Precio unitario', type: 'number', copyFrom: 'productos.precio', editable: true },
          { name: 'cantidad', label: 'Cantidad', type: 'number' }
        ]
      },
      isRequired: false
    })
    const columns = (field.validationRules as { columns: Array<Record<string, unknown>> }).columns
    expect(columns[0]).toMatchObject({ name: 'producto_id', type: 'relation', relationEntity: 'productos' })
    expect(columns[1]).toMatchObject({ name: 'precio_unitario', copyFrom: 'productos.precio', editable: true })
  })

  it('createEntityField rechaza un nombre duplicado dentro de la misma entity', async () => {
    await expect(
      createEntityField(TENANT_A, entityA, { name: 'nombre', label: 'Nombre otra vez', dataType: 'text', validationRules: {}, isRequired: false })
    ).rejects.toBeInstanceOf(DuplicateFieldNameError)
  })

  it('createEntityField permite el mismo nombre en entities distintas', async () => {
    const field = await createEntityField(TENANT_B, entityB, { name: 'nombre', label: 'Nombre', dataType: 'text', validationRules: {}, isRequired: false })
    expect(field.name).toBe('nombre')
  })

  it('createEntityField lanza EntityNotFoundError si la entity no es del tenant', async () => {
    await expect(
      createEntityField(TENANT_B, entityA, { name: 'otro', label: 'Otro', dataType: 'text', validationRules: {}, isRequired: false })
    ).rejects.toBeInstanceOf(EntityNotFoundError)
  })

  it('updateEntityField: editar solo label NO escribe historial ni marca is_dirty', async () => {
    const field = await createEntityField(TENANT_A, entityA, { name: 'apellido', label: 'Apellido', dataType: 'text', validationRules: {}, isRequired: false })
    const [record] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_A}, ${entityA}, '{}') returning id, is_dirty`
    expect(record.is_dirty).toBe(false)

    const updated = await updateEntityField(TENANT_A, field.id, { label: 'Apellidos' }, null)
    expect(updated).toMatchObject({ label: 'Apellidos' })

    const history = await admin`select id from entity_field_history where entity_field_id = ${field.id}`
    expect(history).toHaveLength(0)

    const [refreshedRecord] = await admin`select is_dirty from records where id = ${record.id}`
    expect(refreshedRecord.is_dirty).toBe(false)
  })

  it('updateEntityField: cambiar dataType escribe un snapshot con el valor VIEJO en entity_field_history y marca is_dirty via trigger de Postgres', async () => {
    const field = await createEntityField(TENANT_A, entityA, { name: 'codigo', label: 'Codigo', dataType: 'text', validationRules: {}, isRequired: false })
    const [record] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_A}, ${entityA}, '{}') returning id`

    const changedBy = randomUUID()
    const updated = await updateEntityField(TENANT_A, field.id, { dataType: 'number', validationRules: {} }, changedBy)
    expect(updated).toMatchObject({ dataType: 'number' })

    const [historyRow] = await admin`select data_type, is_required, changed_by from entity_field_history where entity_field_id = ${field.id}`
    // El snapshot es de COMO ERA antes del cambio (text), no del estado nuevo.
    expect(historyRow).toMatchObject({ data_type: 'text', is_required: false, changed_by: changedBy })

    const [refreshedRecord] = await admin`select is_dirty from records where id = ${record.id}`
    expect(refreshedRecord.is_dirty).toBe(true)
  })

  it('updateEntityField rechaza (sin guardar nada) si el dataType nuevo no es compatible con las validationRules vigentes', async () => {
    const field = await createEntityField(TENANT_A, entityA, {
      name: 'puntaje',
      label: 'Puntaje',
      dataType: 'number',
      validationRules: { min: 0, max: 100 },
      isRequired: false
    })

    await expect(updateEntityField(TENANT_A, field.id, { dataType: 'boolean' }, null)).rejects.toBeInstanceOf(InvalidValidationRulesError)

    const [unchanged] = await admin`select data_type from entity_fields where id = ${field.id}`
    expect(unchanged.data_type).toBe('number')
    const history = await admin`select id from entity_field_history where entity_field_id = ${field.id}`
    expect(history).toHaveLength(0)
  })

  it('updateEntityField devuelve null si el campo no existe o es de otra entity/tenant', async () => {
    expect(await updateEntityField(TENANT_A, randomUUID(), { label: 'X' }, null)).toBeNull()

    const fieldB = await createEntityField(TENANT_B, entityB, { name: 'exclusivo_b', label: 'Exclusivo B', dataType: 'text', validationRules: {}, isRequired: false })
    expect(await updateEntityField(TENANT_A, fieldB.id, { label: 'Hackeado' }, null)).toBeNull()
  })

  it('deleteEntityField borra el campo pero NO toca custom_data de los records (queda huerfano en el JSON)', async () => {
    const field = await createEntityField(TENANT_A, entityA, { name: 'temporal', label: 'Temporal', dataType: 'text', validationRules: {}, isRequired: false })
    const [record] =
      await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_A}, ${entityA}, ${admin.json({ temporal: 'dato viejo' })}) returning id`

    const result = await deleteEntityField(TENANT_A, field.id)
    expect(result).toBe('deleted')

    const [gone] = await admin`select id from entity_fields where id = ${field.id}`
    expect(gone).toBeUndefined()

    const [refreshedRecord] = await admin`select custom_data, is_dirty from records where id = ${record.id}`
    expect(refreshedRecord.custom_data).toEqual({ temporal: 'dato viejo' })
    expect(refreshedRecord.is_dirty).toBe(true)
  })

  it('deleteEntityField devuelve "not-found" si el campo no existe o es de otro tenant (no distingue - no filtra fuga de existencia entre tenants)', async () => {
    expect(await deleteEntityField(TENANT_A, randomUUID())).toBe('not-found')

    const fieldB = await createEntityField(TENANT_B, entityB, { name: 'no_borrable_desde_a', label: 'X', dataType: 'text', validationRules: {}, isRequired: false })
    expect(await deleteEntityField(TENANT_A, fieldB.id)).toBe('not-found')
    const [stillThere] = await admin`select id from entity_fields where id = ${fieldB.id}`
    expect(stillThere).toBeDefined()
  })
})

// Pedido directo del usuario (2026-09-04): dataType 'incremental' - a
// diferencia del resto de assertValidationRules() (solo FORMA, cubierto en
// test/unit/dynamicSchema.test.ts), prefixSource necesita validacion CRUZADA
// contra otras filas reales de entity_fields/entities (assertIncrementalConfig(),
// ver comentario largo en moduleEntityFields.ts) - por eso vive aca, no en el
// test unitario.
describe('moduleEntityFields - incremental (Postgres real)', () => {
  let entityIncremental: string
  let entityMercado: string

  beforeAll(async () => {
    const [ent] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_A}, 'Recepciones Inc', 'recepciones-inc') returning id`
    entityIncremental = ent.id as string
    const [merc] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_A}, 'Mercado Inc', 'mercado-inc') returning id`
    entityMercado = merc.id as string
    await admin`insert into entity_fields (entity_id, name, label, data_type) values (${entityMercado}, 'codigo', 'Código', 'text')`
  })

  it('acepta un incremental "simple" (sin prefixSource)', async () => {
    const field = await createEntityField(TENANT_A, entityIncremental, {
      name: 'folio',
      label: 'Folio',
      dataType: 'incremental',
      validationRules: { digits: 10 },
      isRequired: false
    })
    expect(field.dataType).toBe('incremental')
  })

  it('acepta un incremental con prefixSource valido (campo relation propio + campo texto de la entidad relacionada)', async () => {
    const relField = await createEntityField(TENANT_A, entityIncremental, {
      name: 'mercado',
      label: 'Mercado',
      dataType: 'relation',
      validationRules: { relationEntity: 'mercado-inc' },
      isRequired: true
    })
    expect(relField.dataType).toBe('relation')

    const incremental = await createEntityField(TENANT_A, entityIncremental, {
      name: 'codigo_pieza',
      label: 'Código de pieza',
      dataType: 'incremental',
      validationRules: { digits: 6, prefixSource: { relationField: 'mercado', sourceField: 'codigo' } },
      isRequired: false
    })
    expect(incremental.validationRules).toEqual({ digits: 6, prefixSource: { relationField: 'mercado', sourceField: 'codigo' } })
  })

  it('rechaza prefixSource.relationField que no es un campo real de esta misma entidad', async () => {
    await expect(
      createEntityField(TENANT_A, entityIncremental, {
        name: 'otro_incremental',
        label: 'Otro',
        dataType: 'incremental',
        validationRules: { digits: 6, prefixSource: { relationField: 'no_existe', sourceField: 'codigo' } },
        isRequired: false
      })
    ).rejects.toBeInstanceOf(InvalidValidationRulesError)
  })

  it('rechaza prefixSource.relationField que existe pero no es de tipo Relación', async () => {
    await createEntityField(TENANT_A, entityIncremental, { name: 'nombre_propio', label: 'Nombre', dataType: 'text', validationRules: {}, isRequired: false })
    await expect(
      createEntityField(TENANT_A, entityIncremental, {
        name: 'otro_incremental_2',
        label: 'Otro',
        dataType: 'incremental',
        validationRules: { digits: 6, prefixSource: { relationField: 'nombre_propio', sourceField: 'codigo' } },
        isRequired: false
      })
    ).rejects.toBeInstanceOf(InvalidValidationRulesError)
  })

  it('rechaza prefixSource.relationField de tipo Relación sin entidad relacionada configurada', async () => {
    await createEntityField(TENANT_A, entityIncremental, { name: 'relacion_suelta', label: 'Relación suelta', dataType: 'relation', validationRules: {}, isRequired: false })
    await expect(
      createEntityField(TENANT_A, entityIncremental, {
        name: 'otro_incremental_3',
        label: 'Otro',
        dataType: 'incremental',
        validationRules: { digits: 6, prefixSource: { relationField: 'relacion_suelta', sourceField: 'codigo' } },
        isRequired: false
      })
    ).rejects.toBeInstanceOf(InvalidValidationRulesError)
  })

  it('rechaza prefixSource.sourceField que no es un campo de texto real de la entidad relacionada', async () => {
    await expect(
      createEntityField(TENANT_A, entityIncremental, {
        name: 'otro_incremental_4',
        label: 'Otro',
        dataType: 'incremental',
        validationRules: { digits: 6, prefixSource: { relationField: 'mercado', sourceField: 'no_existe' } },
        isRequired: false
      })
    ).rejects.toBeInstanceOf(InvalidValidationRulesError)
  })

  it('updateEntityField vuelve a validar prefixSource cuando se edita validationRules', async () => {
    const field = await createEntityField(TENANT_A, entityIncremental, {
      name: 'folio_editable',
      label: 'Folio editable',
      dataType: 'incremental',
      validationRules: { digits: 6 },
      isRequired: false
    })
    await expect(
      updateEntityField(TENANT_A, field.id, { validationRules: { digits: 6, prefixSource: { relationField: 'no_existe', sourceField: 'codigo' } } }, null)
    ).rejects.toBeInstanceOf(InvalidValidationRulesError)
  })
})
