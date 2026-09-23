import { randomUUID, sign } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(process.argv.slice(2).map((value, index, values) => {
  if (!value.startsWith('--')) return []
  return [value.slice(2), values[index + 1]]
}).filter(entry => entry.length === 2))

if (!args.request || !args.customer || !args.expires || !args.out) {
  throw new Error('Uso: npm run license:issue -- --request CODIGO --customer "Empresa" --expires 2027-09-18 --out empresa.license')
}

let request
try { request = JSON.parse(Buffer.from(args.request, 'base64url').toString('utf8')) }
catch { throw new Error('Codigo de solicitud invalido') }
if (request?.version !== 1 || typeof request.installationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(request.installationId) || typeof request.machineHash !== 'string' || !/^[a-f0-9]{64}$/.test(request.machineHash)) {
  throw new Error('Codigo de solicitud invalido')
}
if (args.customer.trim().length < 2 || args.customer.length > 160) throw new Error('Nombre de cliente invalido')
if (!/^\d{4}-\d{2}-\d{2}$/.test(args.expires) || !Number.isFinite(Date.parse(`${args.expires}T23:59:59.999Z`))) throw new Error('Fecha de vencimiento invalida')
const expiresAt = `${args.expires}T23:59:59.999Z`
if (Date.parse(expiresAt) <= Date.now()) throw new Error('La fecha de vencimiento debe ser futura')

const privatePath = process.env.FLOWERP_ISSUER_PRIVATE_KEY || path.join(root, '.license-issuer/private.pem')
const privateKey = readFileSync(privatePath, 'utf8')
const payload = Buffer.from(JSON.stringify({
  version: 1,
  licenseId: randomUUID(),
  customer: args.customer.trim(),
  installationId: request.installationId,
  machineHash: request.machineHash,
  issuedAt: new Date().toISOString(),
  expiresAt
})).toString('base64url')
const signature = sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url')
const output = path.resolve(args.out)
writeFileSync(output, JSON.stringify({ payload, signature }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(`Licencia generada: ${output}`)
