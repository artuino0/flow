import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres, { type Sql } from 'postgres'
import { createTestDb, type TestDb } from '../setup/testDb'

// Bug real, encontrado en produccion (2026-09-04): listActiveMembershipsForPerson
// y findActiveMembership (server/utils/peopleAuth.ts) son por definicion
// consultas cross-tenant sobre `users` (buscan las membresias de una persona
// en CUALQUIER tenant, antes de saber cual es "el" tenant) - pero `users`
// tiene FORCE ROW LEVEL SECURITY (migracion 0010), que exige
// current_setting('app.tenant_id', true)::uuid = tenant_id. Sin ese GUC
// seteado, la policy SIEMPRE oculta todas las filas (0 resultados) o, en una
// conexion pooled que YA lo seteo antes en otra transaccion, lanza
// "invalid input syntax for type uuid" (ver el hallazgo documentado en
// rlsTenantIsolation.test.ts) - en ningun caso ve una membresia real, sin
// importar cuantas existan. Esta suite prueba el bug (documentado, no
// arreglado ahi) y el fix real: la policy self_membership_lookup_users
// (migracion 0031) + withPerson() (server/db/index.ts), contra un Postgres
// real conectado como erp_app (no superusuario - Postgres bypassea RLS para
// superusuarios sin importar FORCE ROW LEVEL SECURITY).
//
// Tambien prueba el bug SIMETRICO encontrado despues (mismo dia): agregar
// una segunda policy permissive a `users` significa que CUALQUIER consulta a
// `users` ahora depende de que AMBOS GUCs (app.tenant_id y app.person_id)
// esten en un estado que no reviente el cast a uuid - no solo el que esa
// consulta puntual necesita. withTenant() tenia que resetear app.person_id
// exactamente igual que withPerson() ya reseteaba app.tenant_id.

const TENANT_ID = '33333333-3333-3333-3333-333333333333'
const OTHER_TENANT_ID = '44444444-4444-4444-4444-444444444444'
const PERSON_ID = '55555555-5555-5555-5555-555555555555'
const OTHER_PERSON_ID = '66666666-6666-6666-6666-666666666666'

let testDb: TestDb
let app: Sql
let userId: string

beforeAll(async () => {
  testDb = await createTestDb()
  // max:1 a proposito, igual que rlsTenantIsolation.test.ts: fuerza que
  // todas las queries de este archivo compartan la misma conexion fisica,
  // para poder probar deliberadamente el escenario de "conexion pooled que
  // ya seteo app.tenant_id antes" (el modo de fallo real que se vio en
  // produccion, no solo el caso feliz de una conexion nueva).
  app = postgres(testDb.appUrl, { max: 1 })

  // people y tenants no tienen RLS (ver el comentario largo en
  // server/db/schema.ts) - se insertan directo, sin contexto.
  await app.unsafe(
    `insert into people (id, email, password_hash, full_name) values ('${PERSON_ID}', 'multi@acme.test', 'x', 'Multi Org')`
  )
  await app.unsafe(`insert into tenants (id, name, slug) values ('${TENANT_ID}', 'Tenant Uno', 'tenant-uno')`)
  await app.unsafe(`insert into tenants (id, name, slug) values ('${OTHER_TENANT_ID}', 'Tenant Dos', 'tenant-dos')`)

  // users SI tiene RLS - el INSERT necesita app.tenant_id seteado al tenant
  // real (tenant_isolation_users tambien rige INSERT/WITH CHECK).
  const [role] = await app.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.tenant_id', '${TENANT_ID}', true)`)
    const [r] = await tx.unsafe(`insert into roles (tenant_id, name, is_system) values ('${TENANT_ID}', 'Administrador', true) returning id`)
    await tx.unsafe(
      `insert into users (tenant_id, person_id, role_id, is_active) values ('${TENANT_ID}', '${PERSON_ID}', '${r.id}', true)`
    )
    return [r]
  })
  const [u] = await app.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.tenant_id', '${TENANT_ID}', true)`)
    return tx.unsafe(`select id from users where tenant_id = '${TENANT_ID}' and person_id = '${PERSON_ID}'`)
  })
  userId = u.id
  void role
}, 30000)

afterAll(async () => {
  await app.end()
  await testDb.stop()
})

describe('bug real: lookup cross-tenant de membresias sin contexto (users, RLS)', () => {
  it('un SELECT sin ningun app.tenant_id/app.person_id seteado NO ve la membresia real (el bug tal cual se encontro)', async () => {
    const fresh = postgres(testDb.appUrl, { max: 1 })
    try {
      const rows = await fresh.unsafe(`select id from users where person_id = '${PERSON_ID}'`)
      expect(rows).toHaveLength(0)
    } finally {
      await fresh.end()
    }
  })

  it('en la conexion compartida (que ya uso set_config antes), el mismo SELECT lanza el error de cast a uuid, no "0 filas"', async () => {
    // "app" ya corrio transacciones con set_config('app.tenant_id', ..., true)
    // en el beforeAll - el placeholder del GUC quedo en '' al cerrar esas
    // transacciones (hallazgo documentado en rlsTenantIsolation.test.ts), no
    // en NULL. Esto reproduce el "Server Error" 500 visto en el navegador.
    await expect(app.unsafe(`select id from users where person_id = '${PERSON_ID}'`)).rejects.toThrow(/invalid input syntax for type uuid/)
  })
})

describe('fix: policy self_membership_lookup_users (migracion 0031) + withPerson()', () => {
  // Espeja EXACTAMENTE withPerson() (server/db/index.ts): tambien resetea
  // app.tenant_id a un uuid valido que nunca matchea ningun tenant real -
  // sin esto, en una conexion pooled "envenenada" (como esta misma, por el
  // describe de arriba), la OTRA policy (tenant_isolation_users) revienta
  // con el cast a uuid antes de que esta llegue a aplicar. Hallazgo real,
  // no un detalle de test.
  async function asPerson<T>(personId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    const result = await app.begin(async (tx) => {
      await tx.unsafe(`select set_config('app.tenant_id', '00000000-0000-0000-0000-000000000000', true)`)
      await tx.unsafe(`select set_config('app.person_id', '${personId}', true)`)
      return fn(tx)
    })
    return result as T
  }

  it('con app.person_id seteado, SI ve su propia membresia - incluso en la conexion "envenenada" de arriba', async () => {
    const rows = await asPerson(PERSON_ID, (tx) => tx.unsafe(`select id, tenant_id from users where person_id = '${PERSON_ID}'`))
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(userId)
    expect(rows[0].tenant_id).toBe(TENANT_ID)
  })

  it('la membresia se ve SIN pasar app.tenant_id - es deliberadamente cross-tenant', async () => {
    const rows = await asPerson(PERSON_ID, (tx) => tx.unsafe(`select tenant_id from users where person_id = '${PERSON_ID}' and is_active = true`))
    expect(rows.map((r) => r.tenant_id)).toEqual([TENANT_ID])
  })

  it('no deja ver las membresias de OTRA persona (la excepcion sigue angosta, no es un bypass general)', async () => {
    const rows = await asPerson(OTHER_PERSON_ID, (tx) => tx.unsafe(`select id from users where person_id = '${PERSON_ID}'`))
    expect(rows).toHaveLength(0)
  })

  it('la policy nueva es de solo SELECT: un INSERT con app.person_id seteado (sin app.tenant_id valido) sigue rechazado', async () => {
    await expect(
      asPerson(PERSON_ID, (tx) =>
        tx.unsafe(
          `insert into users (tenant_id, person_id, role_id, is_active) values ('${OTHER_TENANT_ID}', '${PERSON_ID}', null, true)`
        )
      )
    ).rejects.toThrow()
  })
})

// Bug simetrico real, encontrado en produccion (2026-09-04) DESPUES del fix
// de arriba: agregar self_membership_lookup_users tiene un costo que no
// alcanza con pagar solo en withPerson(). Los tests de "fix" de arriba ya
// corrieron varios asPerson() sobre esta misma conexion (max:1) - eso deja
// app.person_id en '' para el resto de la sesion (mismo hallazgo, GUC
// distinto). GET /api/auth/me y POST /api/auth/refresh son withTenant()
// comunes, con tenant conocido, que jamas deberian enterarse de que existe
// una segunda policy sobre `users` - pero como Postgres evalua AMBAS
// policies permissive (OR) y la de self_membership_lookup_users revienta con
// el cast de '' a uuid, la consulta entera falla igual. Por eso withTenant()
// (server/db/index.ts) tambien resetea app.person_id a un uuid inofensivo,
// simetrico a lo que withPerson() ya hacia con app.tenant_id.
describe('bug simetrico + fix: withTenant() tambien debe resetear app.person_id', () => {
  it('sin ese reset, un SELECT tenant-scoped normal en la conexion ya envenenada por withPerson() lanza el mismo cast a uuid (reproduce GET /api/auth/me)', async () => {
    await expect(
      app.begin(async (tx) => {
        await tx.unsafe(`select set_config('app.tenant_id', '${TENANT_ID}', true)`)
        // A proposito NO se resetea app.person_id aca - version "sin el fix".
        return tx.unsafe(`select id from users where id = '${userId}'`)
      })
    ).rejects.toThrow(/invalid input syntax for type uuid/)
  })

  it('con el reset simetrico (como el withTenant() real), la misma consulta funciona pese a la conexion envenenada', async () => {
    async function asTenant<T>(tenantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
      const result = await app.begin(async (tx) => {
        await tx.unsafe(`select set_config('app.person_id', '00000000-0000-0000-0000-000000000000', true)`)
        await tx.unsafe(`select set_config('app.tenant_id', '${tenantId}', true)`)
        return fn(tx)
      })
      return result as T
    }

    const rows = await asTenant(TENANT_ID, (tx) => tx.unsafe(`select id from users where id = '${userId}'`))
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(userId)
  })
})
