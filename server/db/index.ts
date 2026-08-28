import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import * as schema from './schema'

// En runtime la app debe conectarse con APP_DATABASE_URL (rol "erp_app", sin
// privilegios de superusuario) para que las politicas RLS (HU-ERD-12) apliquen.
// DATABASE_URL (rol "erp_admin") es solo para drizzle-kit / migraciones.
const connectionString =
  process.env.APP_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://erp_app:changeme_app@localhost:5433/erp_dinamico'

const client = postgres(connectionString)

export const db = drizzle(client, { schema })

/**
 * Corre `fn` dentro de una transaccion con `app.tenant_id` seteado via
 * set_config(), para que las politicas RLS filtren por ese tenant.
 * Toda consulta a tablas multi-tenant (HU-ERD-15 en adelante) debe pasar por aca.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: typeof db) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`)
    return fn(tx as unknown as typeof db)
  })
}
