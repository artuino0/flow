import 'dotenv/config'
import fs from 'node:fs/promises'
import postgres from 'postgres'

const client = postgres(process.env.DATABASE_URL, { max: 1 })
try {
  const migration = await fs.readFile(new URL('../server/db/migrations/0044_global_search.sql', import.meta.url), 'utf8')
  await client.begin(async tx => {
    for (const statement of migration.split('--> statement-breakpoint')) await tx.unsafe(statement)
  })
  const [result] = await client`select public.flow_search_text('{"nombre":"Agrícola Muñoz","folio":"REC-123"}'::jsonb) as value`
  if (!result.value.includes('agricola munoz')) throw new Error('La normalización no coincide')
  console.log('Índice de búsqueda instalado y normalización verificada.')
} finally { await client.end() }
