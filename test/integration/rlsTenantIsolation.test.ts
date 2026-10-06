import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres, { type Sql, type TransactionSql } from 'postgres'
import { createTestDb, type TestDb } from '../setup/testDb'

// HU-ERD-29: confirma el aislamiento por tenant_id (RLS, HU-ERD-12) contra un
// Postgres REAL, conectado como erp_app (el rol sin privilegios que usa la
// app en runtime - ver server/db/index.ts) - no como superusuario, porque
// Postgres bypassea RLS para superusuarios sin importar FORCE ROW LEVEL
// SECURITY. La prueba clave: consultar SIN el WHERE tenant_id que pondria
// Drizzle/el endpoint (el "filtro de Drizzle omitido" del criterio de
// aceptacion) y confirmar que igual no se ve nada de otro tenant.

const TENANT_A = '11111111-1111-1111-1111-111111111111'
const TENANT_B = '22222222-2222-2222-2222-222222222222'

let testDb: TestDb
let app: Sql

async function asTenant<T>(tenantId: string, fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
  const result = await app.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.tenant_id', '${tenantId}', true)`)
    // Fixture de aislamiento de tenant: sistema explícito, erp_app sigue sujeto a RLS.
    await tx`select set_config('app.user_id', '00000000-0000-0000-0000-000000000000', true), set_config('app.role_id', '00000000-0000-0000-0000-000000000000', true), set_config('app.record_system', 'on', true)`
    return fn(tx)
  })
  return result as T
}

beforeAll(async () => {
  testDb = await createTestDb()
  const owner = postgres(testDb.ownerUrl)
  await owner`insert into tenants(id,name) values (${TENANT_A},'A sintético'),(${TENANT_B},'B sintético')`
  await owner.end()
  // max:1 a proposito: fuerza que TODAS las queries de este archivo compartan
  // la misma conexion fisica, para que el comportamiento del GUC app.tenant_id
  // entre tests sea determinista (ver el test de "conexion que ya uso
  // set_config" mas abajo).
  app = postgres(testDb.appUrl, { max: 1 })

  await asTenant(TENANT_A, async (tx) => {
    await tx.unsafe(`insert into entities (tenant_id, name, slug) values ('${TENANT_A}', 'Clientes A', 'clientes-a')`)
  })
  await asTenant(TENANT_B, async (tx) => {
    await tx.unsafe(`insert into entities (tenant_id, name, slug) values ('${TENANT_B}', 'Clientes B', 'clientes-b')`)
  })
}, 30000)

afterAll(async () => {
  await app.end()
  await testDb.stop()
})

describe('RLS: aislamiento por tenant_id (Postgres real, rol erp_app)', () => {
  it('erp_app NO es superusuario (si esto fallara, el resto de la suite no probaria nada)', async () => {
    const [row] = await app.unsafe(`select rolsuper from pg_roles where rolname = 'erp_app'`)
    expect(row.rolsuper).toBe(false)
  })

  it('un SELECT sin WHERE tenant_id (filtro de Drizzle omitido) solo devuelve filas del tenant activo', async () => {
    const rows = await asTenant(TENANT_A, (tx) => tx.unsafe('select slug from entities'))
    expect(rows.map((r) => r.slug)).toEqual(['clientes-a'])
  })

  it('el otro tenant, con el mismo query sin WHERE, solo ve sus propias filas', async () => {
    const rows = await asTenant(TENANT_B, (tx) => tx.unsafe('select slug from entities'))
    expect(rows.map((r) => r.slug)).toEqual(['clientes-b'])
  })

  it('en una conexion nueva que NUNCA seteo app.tenant_id, no se ve ninguna fila (no defaultea a "ver todo")', async () => {
    // Conexion dedicada (no la del pool compartido "app"): antes de que
    // CUALQUIER sesion llame set_config('app.tenant_id', ...), el GUC no
    // existe y current_setting(..., true) devuelve NULL limpio -> 0 filas.
    const fresh = postgres(testDb.appUrl, { max: 1 })
    try {
      const rows = await fresh.unsafe('select slug from entities')
      expect(rows).toHaveLength(0)
    } finally {
      await fresh.end()
    }
  })

  it('en una conexion que YA uso set_config alguna vez, limpiarlo hace fallar la query (no "ver todo") - hallazgo documentado', async () => {
    // Quirk real de Postgres, descubierto escribiendo este test: set_config
    // con is_local=true (SET LOCAL) crea un "placeholder" para el GUC
    // custom que persiste en la sesion; al terminar la transaccion, el valor
    // vuelve a '' (string vacio), no a NULL. current_setting(...)::uuid
    // sobre '' lanza un error de Postgres en vez de devolver 0 filas - sigue
    // siendo seguro (no hay fuga de datos de otro tenant, la query
    // simplemente falla), pero es un modo de fallo distinto al que se
    // podria asumir. Documentado aca en vez de "arreglado" porque cambiar
    // las policies ya migradas (0008/0010/0014) esta fuera del alcance de
    // HU-ERD-29 (esta HU es de tests, no de fixes) - queda como hallazgo
    // para una HU de hardening aparte si se decide encarar.
    await asTenant(TENANT_A, async () => {})
    await expect(app.unsafe('select slug from entities')).rejects.toThrow(/invalid input syntax for type uuid/)
  })

  it('un INSERT con tenant_id de OTRO tenant (bajo el contexto de A) es rechazado por la policy', async () => {
    await expect(
      asTenant(TENANT_A, (tx) => tx.unsafe(`insert into entities (tenant_id, name, slug) values ('${TENANT_B}', 'Colada', 'colada')`))
    ).rejects.toThrow()
  })

  it('lo mismo aplica sobre records (no solo entities)', async () => {
    const entityA = await asTenant(TENANT_A, (tx) => tx.unsafe(`select id from entities where slug = 'clientes-a'`))
    const entityB = await asTenant(TENANT_B, (tx) => tx.unsafe(`select id from entities where slug = 'clientes-b'`))

    await asTenant(TENANT_A, (tx) =>
      tx.unsafe(`insert into records (entity_id, tenant_id, custom_data) values ('${entityA[0].id}', '${TENANT_A}', '{"nombre":"A1"}')`)
    )
    await asTenant(TENANT_B, (tx) =>
      tx.unsafe(`insert into records (entity_id, tenant_id, custom_data) values ('${entityB[0].id}', '${TENANT_B}', '{"nombre":"B1"}')`)
    )

    const rowsAsA = await asTenant(TENANT_A, (tx) => tx.unsafe('select custom_data from records'))
    expect(rowsAsA.map((r) => r.custom_data.nombre)).toEqual(['A1'])
  })

  it('0091 sigue fail-closed sin actor ni sistema, incluso con tenant válido', async () => {
    const rows = await asTenant(TENANT_A, async tx => {
      await tx`select set_config('app.record_system', 'off', true)`
      return tx`select custom_data from records`
    })
    expect(rows).toHaveLength(0)
    // El contexto de sistema de una fixture no se vuelve un permiso por omisión.
    const visible = await asTenant(TENANT_A, tx => tx`select custom_data from records`)
    expect(visible.map(row => row.custom_data.nombre)).toEqual(['A1'])
  })
})
