import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const issuerDir = path.join(root, '.license-issuer')
const privatePath = path.join(issuerDir, 'private.pem')
const publicSourcePath = path.join(root, 'server/utils/licenseIssuerPublicKey.ts')

if (existsSync(privatePath)) throw new Error('La clave privada ya existe. No la reemplaces: invalidarías las licencias emitidas.')

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' })
const publicPem = publicKey.export({ type: 'spki', format: 'pem' })
mkdirSync(issuerDir, { recursive: true, mode: 0o700 })
writeFileSync(privatePath, privatePem, { mode: 0o600, flag: 'wx' })
writeFileSync(publicSourcePath, `// Clave publica del emisor; la privada nunca se incluye en un deployment.\nexport const LICENSE_ISSUER_PUBLIC_KEY = ${JSON.stringify(publicPem)}\n`)
console.log(`Clave privada (respaldar fuera del proyecto, NUNCA entregar al cliente): ${privatePath}`)
console.log(`Clave publica incluida en la app: ${publicSourcePath}`)
