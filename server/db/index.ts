import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

const connectionString =
  process.env.DATABASE_URL || 'postgresql://erp_admin:changeme@localhost:5433/erp_dinamico'

const client = postgres(connectionString)

export const db = drizzle(client, { schema: undefined })
