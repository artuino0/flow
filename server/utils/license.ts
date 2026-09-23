import { createHash, createPublicKey, verify } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { platform } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { LICENSE_ISSUER_PUBLIC_KEY } from './licenseIssuerPublicKey'

declare const __FLOWERP_ONPREM_BUILD__: boolean

// Nitro sustituye este valor durante `build:onprem`. No depende del .env en
// runtime, que el administrador de la instalación podría cambiar.
export const IS_ONPREM_BUILD = typeof __FLOWERP_ONPREM_BUILD__ !== 'undefined' && __FLOWERP_ONPREM_BUILD__

type LicensePayload = {
  version: 1
  licenseId: string
  customer: string
  installationId: string
  machineHash: string
  issuedAt: string
  expiresAt: string
}

type LicenseFile = { payload: string; signature: string }
export type LicenseStatus = {
  required: boolean
  activated: boolean
  reason?: string
  requestCode?: string
  customer?: string
  expiresAt?: string
}

const INSTALLATION_FILE = 'installation.json'
const LICENSE_FILE = 'flowerp.license'

function licenseDir() {
  return path.resolve(process.env.FLOWERP_LICENSE_DIR || path.join(process.cwd(), 'data/license'))
}

function installationId(): string {
  const dir = licenseDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, INSTALLATION_FILE)
  if (!existsSync(file)) {
    try { writeFileSync(file, JSON.stringify({ id: randomUUID() }), { flag: 'wx', mode: 0o600 }) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  const id = JSON.parse(readFileSync(file, 'utf8'))?.id
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Identificador de instalación inválido')
  return id
}

function machineId(): string {
  const override = process.env.FLOWERP_MACHINE_ID_FILE
  if (override) {
    const value = readFileSync(override, 'utf8').trim()
    if (value.length < 8) throw new Error('FLOWERP_MACHINE_ID_FILE no contiene un identificador válido')
    return value
  }

  if (platform() === 'linux') {
    // Un contenedor debe recibir el ID del HOST, no el ID de su filesystem.
    if (existsSync('/.dockerenv')) throw new Error('En Docker monta el machine-id del host y configura FLOWERP_MACHINE_ID_FILE')
    const value = readFileSync('/etc/machine-id', 'utf8').trim()
    if (value.length < 8) throw new Error('El machine-id de Linux no es válido')
    return value
  }
  if (platform() === 'win32') {
    const output = execFileSync('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8' })
    const value = output.match(/MachineGuid\s+REG_SZ\s+(\S+)/i)?.[1]
    if (!value) throw new Error('No se pudo leer MachineGuid de Windows')
    return value
  }
  if (platform() === 'darwin') {
    const output = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' })
    const value = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1]
    if (!value) throw new Error('No se pudo leer el identificador de macOS')
    return value
  }
  throw new Error(`Sistema operativo no admitido para licencias: ${platform()}`)
}

function machineHash(): string {
  return createHash('sha256').update(`flowerp-machine-v1:${platform()}:${machineId()}`).digest('hex')
}

export function verifyLicenseFile(fileContent: string, publicKey: string, expected: { installationId: string; machineHash: string }, now = Date.now()): { valid: true; payload: LicensePayload } | { valid: false; reason: string } {
  try {
    if (fileContent.length > 32_000) return { valid: false, reason: 'El archivo de licencia es demasiado grande' }
    const file = JSON.parse(fileContent) as LicenseFile
    if (typeof file?.payload !== 'string' || !/^[A-Za-z0-9_-]+$/.test(file.payload) || typeof file.signature !== 'string' || !/^[A-Za-z0-9_-]+$/.test(file.signature)) {
      return { valid: false, reason: 'Formato de licencia inválido' }
    }
    const validSignature = verify(null, Buffer.from(file.payload, 'utf8'), createPublicKey(publicKey), Buffer.from(file.signature, 'base64url'))
    if (!validSignature) return { valid: false, reason: 'La firma de la licencia no es válida' }
    const payload = JSON.parse(Buffer.from(file.payload, 'base64url').toString('utf8')) as LicensePayload
    if (payload.version !== 1 || typeof payload.customer !== 'string' || typeof payload.licenseId !== 'string' || typeof payload.issuedAt !== 'string' || typeof payload.expiresAt !== 'string') {
      return { valid: false, reason: 'Datos de licencia inválidos' }
    }
    if (payload.installationId !== expected.installationId || payload.machineHash !== expected.machineHash) {
      return { valid: false, reason: 'Esta licencia pertenece a otra instalación o máquina' }
    }
    const issued = Date.parse(payload.issuedAt)
    const expires = Date.parse(payload.expiresAt)
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued) return { valid: false, reason: 'Vigencia de licencia inválida' }
    if (expires <= now) return { valid: false, reason: 'La licencia venció' }
    return { valid: true, payload }
  } catch {
    return { valid: false, reason: 'No se pudo leer la licencia' }
  }
}

let cachedInstallation: { installationId: string; machineHash: string } | undefined

function currentInstallation() {
  // La máquina y el ID no cambian durante la vida del proceso. En Windows,
  // esto evita invocar reg.exe en cada solicitud de la API.
  cachedInstallation ||= { installationId: installationId(), machineHash: machineHash() }
  return cachedInstallation
}

export function getLicenseStatus(): LicenseStatus {
  if (!IS_ONPREM_BUILD) return { required: false, activated: true }
  try {
    const expected = currentInstallation()
    const requestCode = Buffer.from(JSON.stringify({ version: 1, ...expected })).toString('base64url')
    const file = path.join(licenseDir(), LICENSE_FILE)
    if (!existsSync(file)) return { required: true, activated: false, reason: 'Esta instalación necesita activarse', requestCode }
    const result = verifyLicenseFile(readFileSync(file, 'utf8'), LICENSE_ISSUER_PUBLIC_KEY, expected)
    if (!result.valid) return { required: true, activated: false, reason: result.reason, requestCode }
    return { required: true, activated: true, requestCode, customer: result.payload.customer, expiresAt: result.payload.expiresAt }
  } catch (error) {
    return { required: true, activated: false, reason: error instanceof Error ? error.message : 'No se pudo preparar la activación' }
  }
}

export function installLicense(fileContent: string): LicenseStatus {
  if (!IS_ONPREM_BUILD) throw new Error('Este paquete no requiere activación')
  const expected = currentInstallation()
  const incoming = verifyLicenseFile(fileContent, LICENSE_ISSUER_PUBLIC_KEY, expected)
  if (!incoming.valid) throw new Error(incoming.reason)

  const file = path.join(licenseDir(), LICENSE_FILE)
  if (existsSync(file)) {
    const previous = verifyLicenseFile(readFileSync(file, 'utf8'), LICENSE_ISSUER_PUBLIC_KEY, expected)
    if (previous.valid && Date.parse(incoming.payload.expiresAt) <= Date.parse(previous.payload.expiresAt)) {
      throw new Error('La nueva licencia debe extender la vigencia actual')
    }
  }

  const temp = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, fileContent, { flag: 'wx', mode: 0o600 })
    renameSync(temp, file)
  } finally {
    // Un rename exitoso ya movió el archivo; si falló, se limpia el temporal.
    if (existsSync(temp)) {
      try { unlinkSync(temp) } catch { /* ignore */ }
    }
  }
  return getLicenseStatus()
}
