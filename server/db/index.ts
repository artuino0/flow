import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

// En runtime la app debe conectarse con APP_DATABASE_URL (rol "erp_app", sin
// privilegios de superusuario) para que las politicas RLS (HU-ERD-12) apliquen.
// DATABASE_URL (rol "erp_admin") es solo para drizzle-kit / migraciones.
const connectionString =
  process.env.APP_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://erp_app:changeme_app@localhost:5433/erp_dinamico'

const client = postgres(connectionString)

export const db = drizzle(client, { schema: undefined })

// TODO (ERD-15, middleware RBAC): en cada request, ejecutar
// `SET LOCAL app.tenant_id = '<uuid-del-tenant-autenticado>'` en la misma
// transaccion antes de consultar, para que la RLS filtre correctamente.
