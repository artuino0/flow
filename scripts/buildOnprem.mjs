import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicKeySource = readFileSync(path.join(root, 'server/utils/licenseIssuerPublicKey.ts'), 'utf8')
if (!publicKeySource.includes('-----BEGIN PUBLIC KEY-----')) {
  throw new Error('Primero ejecuta npm run license:keys y conserva la clave privada fuera del paquete entregado.')
}

const nuxt = path.join(root, 'node_modules/nuxt/bin/nuxt.mjs')
const child = spawn(process.execPath, [nuxt, 'build'], {
  cwd: root,
  env: { ...process.env, FLOWERP_DISTRIBUTION: 'onprem' },
  stdio: 'inherit'
})
child.on('error', (error) => { console.error(error); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code || 0 })
