import { withRecordActor } from '../../server/utils/recordActorContext'
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

const actors = new Map<string, { userId: string; roleId: string }>()
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

  for (const tenant of [TENANT_A, TENANT_B]) {
    const [role] = await admin`insert into roles (tenant_id, name, is_system) values (${tenant}, 'Administrador', true) returning id`
    const [person] = await admin`insert into people (email, password_hash, full_name) values (${`${tenant}@prueba.local`}, 'no-login', 'Prueba') returning id`
    const [user] = await admin`insert into users (tenant_id, role_id, person_id) values (${tenant}, ${role.id}, ${person.id}) returning id`
    actors.set(tenant, { userId: user.id, roleId: role.id })
  }

  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ createEntityField, updateEntityField, deleteEntityField, DuplicateFieldNameError, EntityNotFoundError, InvalidValidationRulesError } =
    await import('../../server/utils/moduleEntityFields'))
  const originalCreate = createEntityField
  const originalUpdate = updateEntityField
  const originalDelete = deleteEntityField
  createEntityField = (...args) => withRecordActor(actors.get(args[0])!, () => originalCreate(...args))
  updateEntityField = (...args) => withRecordActor(actors.get(args[0])!, () => originalUpdate(...args))
  deleteEntityField = (...args) => withRecordActor(actors.get(args[0])!, () => originalDelete(...args))
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

  it('updateEntityField permite cambiar un tipo sin valores y elimina reglas incompatibles', async () => {
    const field = await createEntityField(TENANT_A, entityA, { name: 'puntaje', label: 'Puntaje', dataType: 'number', validationRules: { min: 0, max: 100 }, isRequired: false })
    expect(await updateEntityField(TENANT_A, field.id, { dataType: 'boolean' }, null)).toMatchObject({ dataType: 'boolean', validationRules: {} })
    const [changed] = await admin`select data_type, validation_rules from entity_fields where id = ${field.id}`
    expect(changed).toMatchObject({ data_type: 'boolean', validation_rules: {} })
    const history = await admin`select data_type, validation_rules from entity_field_history where entity_field_id = ${field.id}`
    // El servicio y el trigger SQL existente conservan ambos snapshots previos.
    expect(history).toHaveLength(2)
    for (const snapshot of history) expect(snapshot).toMatchObject({ data_type: 'number', validation_rules: { min: 0, max: 100 } })
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

  it('acepta un incremental con prefijo fijo', async () => {
    const field = await createEntityField(TENANT_A, entityIncremental, {
      name: 'folio_fijo',
      label: 'Folio fijo',
      dataType: 'incremental',
      validationRules: { digits: 6, prefix: 'FAC-' },
      isRequired: false
    })
    expect(field.validationRules).toEqual({ digits: 6, prefix: 'FAC-' })
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

describe('HU-ERD-152: tipo bloqueado e impacto aislado por organización', () => {
  it('campo vacío cambia de tipo y limpia reglas anteriores', async () => {
    const field = await createEntityField(TENANT_A, entityA, { name: 'vacio152', label: 'Vacío', dataType: 'text', validationRules: { minLength: 2 }, isRequired: false })
    const result = await updateEntityField(TENANT_A, field.id, { dataType: 'number' }, null)
    expect(result?.dataType).toBe('number')
    expect(result?.validationRules).toEqual({})
  })
  it('valores activos bloquean el tipo, borrados no lo bloquean y otro tenant no filtra', async () => {
    const field = await createEntityField(TENANT_A, entityA, { name: 'tipo152', label: 'Tipo', dataType: 'text', validationRules: {}, isRequired: false })
    const [row] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_A}, ${entityA}, '{"tipo152":"privado"}') returning id`
    await expect(updateEntityField(TENANT_A, field.id, { dataType: 'number' }, null)).rejects.toThrow('ya tiene valores')
    expect(await updateEntityField(TENANT_B, field.id, { dataType: 'number' }, null)).toBeNull()
    await admin`update records set deleted_at = now() where id = ${row.id}`
    expect((await updateEntityField(TENANT_A, field.id, { dataType: 'number' }, null))?.dataType).toBe('number')
  })
  it('impacto cuenta solo nuevos incumplimientos activos, sin modificar datos ni filtrar valores', async () => {
    const field = await createEntityField(TENANT_A, entityA, { name: 'impacto152', label: 'Impacto', dataType: 'text', validationRules: { minLength: 2 }, isRequired: false })
    await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_A}, ${entityA}, '{"impacto152":"xx"}'), (${TENANT_A}, ${entityA}, '{"impacto152":"xxxx"}'), (${TENANT_A}, ${entityA}, '{"impacto152":"x"}')`
    await admin`insert into records (tenant_id, entity_id, custom_data, deleted_at) values (${TENANT_A}, ${entityA}, '{"impacto152":"xx"}', now())`
    await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_B}, ${entityB}, '{"impacto152":"xx"}')`
    const before = await admin`select id, custom_data from records where tenant_id = ${TENANT_A} order by id`
    const result = await updateEntityField(TENANT_A, field.id, { validationRules: { minLength: 3 } }, null)
    expect(result?.validationImpact?.nonCompliantRecords).toBe(1)
    expect(result?.validationImpact?.truncated).toBe(false)
    expect(Object.keys(result!.validationImpact!).sort()).toEqual(['limit', 'nonCompliantRecords', 'scannedRecords', 'truncated'])
    expect(await admin`select id, custom_data from records where tenant_id = ${TENANT_A} order by id`).toEqual(before)
    expect((await updateEntityField(TENANT_A, field.id, { validationRules: { minLength: 1 } }, null))?.validationImpact?.nonCompliantRecords).toBe(0)
  })
  for (const type of ['select', 'multiselect']) it(`${type}: agrega opciones y cambia etiqueta/color, protege value usado`, async () => {
    const name = `${type}152`
    const field = await createEntityField(TENANT_A, entityA, { name, label: 'Opciones', dataType: type, validationRules: { options: [{ value: 'a', label: 'A' }, { value: 'sin_uso', label: 'Sin uso' }] }, isRequired: false })
    await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_A}, ${entityA}, ${admin.json({ [name]: type === 'select' ? 'a' : ['a'] })})`
    expect((await updateEntityField(TENANT_A, field.id, { validationRules: { options: [{ value: 'a', label: 'Renombrada', color: 'red' }, { value: 'b', label: 'B' }] } }, null))?.validationRules).toEqual({ options: [{ value: 'a', label: 'Renombrada', color: 'red' }, { value: 'b', label: 'B' }] })
    await expect(updateEntityField(TENANT_A, field.id, { validationRules: { options: [{ value: 'b', label: 'B' }] } }, null)).rejects.toThrow('opciones en uso: a')
    await expect(updateEntityField(TENANT_A, field.id, { validationRules: { options: [{ value: 'renombrado', label: 'Renombrada' }] } }, null)).rejects.toThrow('opciones en uso: a')
  })
  it('referencias de fecha de otra entidad y reglas heredadas no se guardan', async () => {
    await createEntityField(TENANT_A, entityA, { name: 'inicio152', label: 'Inicio', dataType: 'date', validationRules: {}, isRequired: false })
    await expect(createEntityField(TENANT_A, entityA, { name: 'fin152', label: 'Fin', dataType: 'date', validationRules: { after: 'inicio152' }, isRequired: false })).resolves.toMatchObject({ dataType: 'date' })
    await expect(createEntityField(TENANT_B, entityB, { name: 'fin152', label: 'Fin', dataType: 'date', validationRules: { after: 'inicio152' }, isRequired: false })).rejects.toThrow('misma entidad')
    for (const rules of [{ pattern: 'x' }, { enum: ['a'] }]) await expect(createEntityField(TENANT_A, entityA, { name: 'heredado152', label: 'Heredado', dataType: 'text', validationRules: rules, isRequired: false })).rejects.toBeInstanceOf(InvalidValidationRulesError)
  })
  it('el filtro de relación usa registros activos del destino y metadata de archivos real', async () => {
    const { withTenant: originalWithTenant } = await import('../../server/db')
    const withTenant: typeof originalWithTenant = (tenant, fn) => withRecordActor(actors.get(tenant)!, () => originalWithTenant(tenant, fn))
    const { referenceValidationFailures } = await import('../../server/utils/fieldValidations/references')
    await createEntityField(TENANT_A, entityA, { name: 'elegible152', label: 'Elegible', dataType: 'boolean', validationRules: {}, isRequired: false })
    const rel = { name: 'destino', dataType: 'relation', validationRules: { relationEntity: 'clientes', eligibleFilter: { field: 'elegible152', value: true } } }
    const [eligible] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_A}, ${entityA}, '{"elegible152":true}') returning id`
    const [ineligible] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_A}, ${entityA}, '{"elegible152":false}') returning id`
    const [foreign] = await admin`insert into records (tenant_id, entity_id, custom_data) values (${TENANT_B}, ${entityB}, '{"elegible152":true}') returning id`
    expect(await withTenant(TENANT_A, tx => referenceValidationFailures(tx, TENANT_A, entityA, [rel], { destino: eligible.id }))).toEqual([])
    for (const id of [ineligible.id, foreign.id]) expect(await withTenant(TENANT_A, tx => referenceValidationFailures(tx, TENANT_A, entityA, [rel], { destino: id }))).toEqual(['destino'])
    await admin`update records set deleted_at = now() where id = ${eligible.id}`
    expect(await withTenant(TENANT_A, tx => referenceValidationFailures(tx, TENANT_A, entityA, [rel], { destino: eligible.id }))).toEqual(['destino'])
    const [file] = await admin`insert into files (tenant_id, entity_id, file_name, mime_type, size_bytes, storage_key) values (${TENANT_A}, ${entityA}, 'prueba.pdf', 'application/pdf', 100, 'prueba152') returning id`
    const fileField = { name: 'archivo', dataType: 'file', validationRules: { allowedTypes: ['application/pdf'], maxSizeBytes: 100 } }
    expect(await withTenant(TENANT_A, tx => referenceValidationFailures(tx, TENANT_A, entityA, [fileField], { archivo: file.id }))).toEqual([])
    expect(await withTenant(TENANT_B, tx => referenceValidationFailures(tx, TENANT_B, entityB, [fileField], { archivo: file.id }))).toEqual(['archivo'])
    expect(await withTenant(TENANT_A, tx => referenceValidationFailures(tx, TENANT_A, entityA, [{ ...fileField, validationRules: { maxSizeBytes: 99 } }], { archivo: file.id }))).toEqual(['archivo'])
    expect(await withTenant(TENANT_A, tx => referenceValidationFailures(tx, TENANT_A, entityA, [{ ...fileField, validationRules: { allowedTypes: ['image/png'] } }], { archivo: file.id }))).toEqual(['archivo'])
  })
})

describe('HU-ERD-152 REV2: tipos solo en campos configurados', () => {
  it('usa MIME y extensión persistidos tanto directamente como en la precarga de impacto', async () => {
    const { referenceValidationFailures, preloadValidationReferences } = await import('../../server/utils/fieldValidations/references')
    const { withTenant } = await import('../../server/db')
    const [entity] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_A}, 'Archivo REV2', 'archivo-rev2') returning id`
    for (const [fileName, mimeType, allowed, valid] of [
      ['prueba.pdf', 'application/pdf', 'application/pdf', true],
      ['prueba.exe', 'application/pdf', 'application/pdf', false],
      ['prueba.pdf', 'application/json', 'application/pdf', false],
      ['viejo.doc', 'application/msword', 'application/msword', true],
      ['viejo.xls', 'application/vnd.ms-excel', 'application/vnd.ms-excel', true],
      ['viejo.ppt', 'application/vnd.ms-powerpoint', 'application/vnd.ms-powerpoint', true],
      ['audio.mp3', 'audio/mpeg', 'application/pdf', false],
      ['datos.xml', 'application/xml', 'application/pdf', false]
    ] as const) {
      const [file] = await admin`insert into files (tenant_id, entity_id, file_name, mime_type, size_bytes, storage_key) values (${TENANT_A}, ${entity.id}, ${fileName}, ${mimeType}, 100, 'rev2') returning id`
      for (const validationRules of [{}, { maxSizeBytes: 100 }, { allowedTypes: [allowed] }]) {
        const fields = [{ name: 'archivo', dataType: 'file', validationRules }]
        const data = { archivo: file.id, mimeType: 'application/pdf', fileName: 'cliente.pdf' }
        const expected = 'allowedTypes' in validationRules && !valid ? ['archivo'] : []
        await withTenant(TENANT_A, async tx => {
          expect(await referenceValidationFailures(tx, TENANT_A, entity.id, fields, data)).toEqual(expected)
          const cache = await preloadValidationReferences(tx, TENANT_A, fields, [data])
          expect(await referenceValidationFailures(tx, TENANT_A, entity.id, fields, data, cache)).toEqual(expected)
        })
      }
    }
  })
})

describe('HU-ERD-152: límite del conteo de impacto', () => {
  it('pagina hasta 10000 y declara truncamiento sin devolver valores', async () => {
    const [entity] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_A}, 'Impacto acotado', 'impacto-cap152') returning id`
    const field = await createEntityField(TENANT_A, entity.id, { name: 'valor', label: 'Valor', dataType: 'text', validationRules: {}, isRequired: false })
    await admin`insert into records (tenant_id, entity_id, custom_data) select ${TENANT_A}, ${entity.id}, '{"valor":"aa"}'::jsonb from generate_series(1, 10001)`
    const result = await updateEntityField(TENANT_A, field.id, { validationRules: { minLength: 3 } }, null)
    expect(result?.validationImpact).toEqual({ nonCompliantRecords: 10000, scannedRecords: 10000, truncated: true, limit: 10000 })
    expect((await admin`select count(*)::int as total from records where entity_id = ${entity.id}`)[0].total).toBe(10001)
  })
})
