import { createJiti } from 'jiti'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function runPlatformCrmCli(operation) {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--apply' && arg !== '--dry-run')) throw new Error('Uso: node scripts/<script>.mjs [--apply]')
  const apply = args.includes('--apply')
  // No carga .env ni imprime cadenas. railway run ya inyecta DATABASE_URL.
  if (!process.env.DATABASE_URL && !process.env.APP_DATABASE_URL) throw new Error('Se necesita DATABASE_URL o APP_DATABASE_URL')
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const jiti = createJiti(import.meta.url, { alias: { '~': root }, interopDefault: false })
  let client
  try {
    const crm = await jiti.import(resolve(root, 'server/utils/platformCrm.ts'))
    client = (await jiti.import('~/server/db')).client
    const result = operation === 'install' ? await crm.installPlatformCrm(apply) : await crm.syncPlatformClients({ apply, budgetMs: 300_000 })
    process.stdout.write(`${JSON.stringify({ apply, ...result })}\n`)
    if (result.errors || result.incomplete) process.exitCode = 1
  } catch {
    process.stderr.write('No se pudo completar la operación CRM. Revisa configuración y migraciones.\n')
    process.exitCode = 1
  } finally { if (client) await client.end() }
}
