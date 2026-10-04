import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import * as schema from './schema'
import { currentRecordActor } from '~/server/utils/recordActorContext'
import { instrumentDatabase } from '~/server/utils/requestPerformance'

// En runtime la app debe conectarse con APP_DATABASE_URL (rol "erp_app", sin
// privilegios de superusuario) para que las politicas RLS (HU-ERD-12) apliquen.
// DATABASE_URL (rol "erp_admin") es solo para drizzle-kit / migraciones.
const connectionString =
  process.env.APP_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://erp_app:changeme_app@localhost:5433/erp_dinamico'

// Tamaño del pool de conexiones por proceso (por defecto 10, como postgres.js).
// Con mucha concurrencia es el primer tope: cada petición autenticada abre varias
// transacciones cortas. En serverless (muchas instancias) usa el pooler del
// proveedor (p. ej. Neon) y un valor bajo aquí; en un servidor propio súbelo
// según max_connections de Postgres / número de procesos.
const poolMax = Number(process.env.DB_POOL_MAX)
function positiveSeconds(name: string, fallback: number) { const value = Number(process.env[name]); return Number.isInteger(value) && value > 0 ? value : fallback }
export const client = postgres(connectionString, {
  max: Number.isInteger(poolMax) && poolMax > 0 ? poolMax : 10,
  idle_timeout: positiveSeconds('DB_IDLE_TIMEOUT_SECONDS', 20),
  connect_timeout: positiveSeconds('DB_CONNECT_TIMEOUT_SECONDS', 10),
  keep_alive: positiveSeconds('DB_KEEP_ALIVE_SECONDS', 60)
})
instrumentDatabase(client)

export const db = drizzle(client, { schema })

// uuid que nunca es un id real (ni de tenant ni de persona) - se usa para
// "apagar" a proposito la OTRA policy de `users` cuando withTenant()/
// withPerson() solo necesitan que aplique UNA de las dos. Ver el comentario
// largo de withPerson() mas abajo para el porque.
const NIL_UUID = '00000000-0000-0000-0000-000000000000'

/**
 * Corre `fn` dentro de una transaccion con `app.tenant_id` seteado via
 * set_config(), para que las politicas RLS filtren por ese tenant.
 * Toda consulta a tablas multi-tenant (HU-ERD-15 en adelante) debe pasar por aca.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: typeof db) => Promise<T>
): Promise<T> {
  const actor = currentRecordActor()
  return db.transaction(async (tx) => {
    // Bug real, encontrado en produccion (2026-09-04) DESPUES de agregar
    // self_membership_lookup_users (migracion 0031): esa policy nueva sobre
    // `users` mira current_setting('app.person_id', true)::uuid. Si esta
    // MISMA conexion pooled corrio withPerson() en un request anterior, ese
    // GUC queda en '' (no NULL) para el resto de la sesion - mismo hallazgo
    // documentado en test/integration/rlsTenantIsolation.test.ts, aplicado
    // ahora al OTRO GUC. Sin resetearlo aca, un endpoint tan basico como
    // GET /api/auth/me (una consulta a `users` comun, con tenant conocido,
    // que nunca debería enterarse de que existe una segunda policy) revienta
    // con "invalid input syntax for type uuid" - Postgres evalua ambas
    // policies permissive (OR) y una excepcion en cualquiera de las dos hace
    // fallar la consulta entera. Se resetea a NIL_UUID (nunca matchea
    // ninguna persona real) para que self_membership_lookup_users evalue
    // limpio a "false" en vez de reventar.
    // Un solo viaje a la base: fija ambos GUC en la misma sentencia.
    await tx.execute(sql`select set_config('app.person_id', ${NIL_UUID}, true), set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', ${actor?.userId ?? NIL_UUID}, true), set_config('app.role_id', ${actor?.roleId ?? NIL_UUID}, true), set_config('app.record_system', ${actor?.system === true ? 'on' : 'off'}, true)`)
    return fn(tx as unknown as typeof db)
  })
}

/**
 * Corre `fn` como el proceso de la cola de trabajos: ve los trabajos de TODAS las
 * organizaciones (policy de job_queue con app.job_worker = 'on') y de ninguna otra
 * tabla (app.tenant_id queda en un uuid nulo). Solo lo usa server/utils/jobQueue.ts.
 */
export async function withJobWorker<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.person_id', ${NIL_UUID}, true)`)
    await tx.execute(sql`select set_config('app.tenant_id', ${NIL_UUID}, true)`)
    await tx.execute(sql`select set_config('app.job_worker', 'on', true)`)
    return fn(tx as unknown as typeof db)
  })
}

/**
 * Corre `fn` dentro de una transaccion con `app.person_id` seteado via
 * set_config(), para que la policy self_membership_lookup_users (migracion
 * 0031) permita leer en `users` las membresias de ESA persona, en cualquier
 * tenant, sin conocer todavia cual es "el" tenant - el unico caso de uso
 * real es la resolucion de identidad del login (server/utils/peopleAuth.ts),
 * que es por definicion cross-tenant. Sin esto, `users` (FORCE ROW LEVEL
 * SECURITY, migracion 0010) filtra TODAS las filas ante cualquier consulta
 * que no pase por withTenant() ni por aca - ver el comentario largo en la
 * migracion 0031 para el bug real que esto arregla.
 *
 * NUNCA usar para nada mas: la policy que esto habilita es de solo SELECT y
 * solo deja ver las membresias del propio `personId`, nunca las de otra
 * persona.
 */
export async function withPerson<T>(
  personId: string,
  fn: (tx: typeof db) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    // Hallazgo real, encontrado escribiendo el test de esta funcion
    // (test/integration/peopleMembershipLookup.test.ts): no alcanza con
    // setear SOLO app.person_id. `users` sigue teniendo la policy
    // tenant_isolation_users (migracion 0010), y Postgres combina varias
    // policies permissive con OR evaluando AMBAS expresiones - si esta
    // conexion pooled ya uso set_config('app.tenant_id', ..., true) en un
    // request ANTERIOR (cualquier withTenant() previo en la misma conexion
    // fisica), ese GUC queda en '' (no NULL) para el resto de la sesion
    // (mismo hallazgo que test/integration/rlsTenantIsolation.test.ts
    // documenta), y `current_setting('app.tenant_id', true)::uuid` de
    // tenant_isolation_users lanza "invalid input syntax for type uuid"
    // ANTES de que la policy nueva llegue a aplicar - el OR no evita el
    // error. Por eso tambien se resetea app.tenant_id aca, a un uuid valido
    // que nunca coincide con ningun tenant real, para que esa otra policy
    // evalue limpio a "false" en vez de reventar.
    await tx.execute(sql`select set_config('app.tenant_id', ${NIL_UUID}, true), set_config('app.person_id', ${personId}, true)`)
    return fn(tx as unknown as typeof db)
  })
}
