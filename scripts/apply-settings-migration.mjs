import 'dotenv/config'
import fs from 'node:fs/promises'
import postgres from 'postgres'
const client = postgres(process.env.DATABASE_URL, { max: 1 })
try {
  const migration = await fs.readFile(new URL('../server/db/migrations/0045_settings_sessions.sql', import.meta.url), 'utf8')
  await client.begin(tx => tx.unsafe(migration))
  console.log('Migración de ajustes y sesiones aplicada.')
} finally { await client.end() }
