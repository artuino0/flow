import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { writeSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import postgres from 'postgres'
import { createJiti } from 'jiti'

const [tenantSlug, filename] = process.argv.slice(2)
if (!tenantSlug || !filename) {
  console.error('Uso: node scripts/installBlueprint.mjs <tenant-slug> <archivo.json>')
  process.exitCode = 1
} else {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const source = await readFile(resolve(filename), 'utf8')
  const blueprint = JSON.parse(source)
  const adminUrl = process.env.DATABASE_URL
  if (!adminUrl || !process.env.APP_DATABASE_URL) throw new Error('Se necesitan DATABASE_URL y APP_DATABASE_URL para instalar un plano')
  const admin = postgres(adminUrl)
  let tenantId
  try {
    const [tenant] = await admin`select id from tenants where slug = ${tenantSlug}`
    if (!tenant) throw new Error(`No existe el tenant "${tenantSlug}"`)
    tenantId = tenant.id
  } finally { await admin.end() }
  const jiti = createJiti(import.meta.url, { alias: { '~': root }, interopDefault: false })
  const { applyBlueprint } = await jiti.import(resolve(root, 'server/utils/blueprint/apply.ts'))
  const key = `installer:${createHash('sha256').update(source).digest('hex')}`
  const result = await applyBlueprint(tenantId, null, blueprint, key)
  writeSync(1, `${JSON.stringify(result, null, 2)}\n`)
  const { client } = await jiti.import('~/server/db')
  await client.end()
}
