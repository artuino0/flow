import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type * as PacSettingsModule from '../../server/utils/pacSettings'
import type { getPacProvider as GetPacProvider } from '../../server/utils/pac/provider'

// Fase B de DOCS/HU_Timbrado_CFDI_PAC.md: configuracion PAC por tenant.
// Postgres REAL (RLS FORCE sobre tenant_pac_settings, migracion 0049) + disco
// temporal real (FILES_STORAGE_DIR, patron tenantLogo.test.ts). Las garantias
// que se prueban son las de seguridad: secretos cifrados en reposo, resumen
// publico sin secretos, aislamiento entre tenants y validaciones del CSD.

const TENANT_A = randomUUID()
const TENANT_B = randomUUID()
const API_KEY_PLAIN = 'fk_test_1234567890_secretisima'
const CSD_PASSWORD_PLAIN = 'password-del-key-muy-secreto'

let testDb: TestDb
let admin: postgres.Sql
let storageDir: string
let mod: typeof PacSettingsModule
let getPacProvider: typeof GetPacProvider

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)
  await admin`insert into tenants (id, name) values (${TENANT_A}, 'Empacadora A')`
  await admin`insert into tenants (id, name) values (${TENANT_B}, 'Empacadora B')`

  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-pac-test-'))
  process.env.FILES_STORAGE_DIR = storageDir
  process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key'
  process.env.APP_DATABASE_URL = testDb.appUrl

  mod = await import('../../server/utils/pacSettings')
  ;({ getPacProvider } = await import('../../server/utils/pac/provider'))
}, 60_000)

afterAll(async () => {
  await admin.end()
  fs.rmSync(storageDir, { recursive: true, force: true })
  delete process.env.FILES_STORAGE_DIR
  delete process.env.SETTINGS_ENCRYPTION_KEY
  await testDb.stop()
})

describe('Configuración PAC: resumen público y secretos cifrados', () => {
  it('sin configuración: summary null, full lanza PacNotConfiguredError', async () => {
    expect(await mod.getPacSummary(TENANT_A)).toBeNull()
    await expect(mod.getFullPacSettings(TENANT_A)).rejects.toBeInstanceOf(mod.PacNotConfiguredError)
  })

  it('upsert cifra la API key en reposo y el resumen no la expone', async () => {
    await mod.upsertPacSettings(TENANT_A, null, { apiKey: API_KEY_PLAIN, sandbox: true })

    const [raw] = await admin`select api_key_encrypted from tenant_pac_settings where tenant_id = ${TENANT_A}`
    expect(raw.api_key_encrypted).not.toContain(API_KEY_PLAIN)
    expect(String(raw.api_key_encrypted).startsWith('v1.')).toBe(true)

    const summary = await mod.getPacSummary(TENANT_A)
    expect(summary?.hasApiKey).toBe(true)
    expect(JSON.stringify(summary)).not.toContain(API_KEY_PLAIN)
    expect(JSON.stringify(summary)).not.toContain('apiKeyEncrypted')

    const full = await mod.getFullPacSettings(TENANT_A)
    expect(full.apiKey).toBe(API_KEY_PLAIN)
    expect(full.provider).toBe('facturapi')
  })

  it('upsert sin apiKey conserva el secreto guardado (write-only)', async () => {
    await mod.upsertPacSettings(TENANT_A, null, { sandbox: false })
    const full = await mod.getFullPacSettings(TENANT_A)
    expect(full.apiKey).toBe(API_KEY_PLAIN)
    expect(full.sandbox).toBe(false)
    const summary = await mod.getPacSummary(TENANT_A)
    expect(summary?.sandbox).toBe(false)
  })

  it('RLS: el tenant B no ve la configuración del tenant A', async () => {
    expect(await mod.getPacSummary(TENANT_B)).toBeNull()
    await expect(mod.getFullPacSettings(TENANT_B)).rejects.toBeInstanceOf(mod.PacNotConfiguredError)
    const [raw] = await admin`select api_key_encrypted from tenant_pac_settings where tenant_id = ${TENANT_A}`
    expect(raw.api_key_encrypted).toBeTruthy() // sigue existiendo, solo es invisible para B
  })

  it('getPacProvider resuelve Facturapi con la key descifrada', async () => {
    const provider = await getPacProvider(TENANT_A)
    expect(provider.name).toBe('facturapi')
  })

  it('recordPacTest deja rastro en el resumen', async () => {
    await mod.recordPacTest(TENANT_A, true)
    const summary = await mod.getPacSummary(TENANT_A)
    expect(summary?.lastTestOk).toBe(true)
    expect(summary?.lastTestAt).toBeTruthy()
  })
})

describe('CSD: binarios a disco, contraseña cifrada, validaciones', () => {
  it('subir sin configuración previa lanza PacNotConfiguredError (tenant B)', async () => {
    await expect(
      mod.storeCsdFiles(TENANT_B, { fileName: 'x.cer', buffer: Buffer.from('cer') }, { fileName: 'x.key', buffer: Buffer.from('key') })
    ).rejects.toBeInstanceOf(mod.PacNotConfiguredError)
  })

  it('extensiones inválidas y archivo vacío se rechazan con CsdInvalidError', async () => {
    const cer = { fileName: 'sello.cer', buffer: Buffer.from('cer-dummy') }
    const key = { fileName: 'llave.key', buffer: Buffer.from('key-dummy') }
    await expect(mod.storeCsdFiles(TENANT_A, { fileName: 'sello.pem', buffer: cer.buffer }, key)).rejects.toBeInstanceOf(mod.CsdInvalidError)
    await expect(mod.storeCsdFiles(TENANT_A, cer, { fileName: 'llave.txt', buffer: key.buffer })).rejects.toBeInstanceOf(mod.CsdInvalidError)
    await expect(mod.storeCsdFiles(TENANT_A, { fileName: 'sello.cer', buffer: Buffer.alloc(0) }, key)).rejects.toBeInstanceOf(mod.CsdInvalidError)
    await expect(
      mod.storeCsdFiles(TENANT_A, { fileName: 'grande.cer', buffer: Buffer.alloc(101 * 1024) }, key)
    ).rejects.toBeInstanceOf(mod.CsdInvalidError)
  })

  it('guarda .cer/.key en disco por tenant, cifra la contraseña y reemplaza el CSD anterior borrando el archivo viejo', async () => {
    await mod.upsertPacSettings(TENANT_A, null, { csdPassword: CSD_PASSWORD_PLAIN })
    await mod.storeCsdFiles(
      TENANT_A,
      { fileName: 'CSD_1.cer', buffer: Buffer.from('cer-uno') },
      { fileName: 'CSD_1.key', buffer: Buffer.from('key-uno') }
    )

    let full = await mod.getFullPacSettings(TENANT_A)
    expect(full.csdCerPath && fs.existsSync(full.csdCerPath)).toBe(true)
    expect(full.csdKeyPath && fs.existsSync(full.csdKeyPath)).toBe(true)
    expect(full.csdPassword).toBe(CSD_PASSWORD_PLAIN)
    expect(full.csdCerPath!.startsWith(path.join(storageDir, TENANT_A))).toBe(true)
    const primerCer = full.csdCerPath!

    const summary = await mod.getPacSummary(TENANT_A)
    expect(summary?.hasCsd).toBe(true)
    expect(summary?.csdCerFileName).toBe('CSD_1.cer')
    // .cer dummy no es un X509 real: la vigencia es best-effort y queda null
    expect(summary?.csdValidUntil).toBeNull()

    // contraseña cifrada en reposo
    const [raw] = await admin`select csd_password_encrypted from tenant_pac_settings where tenant_id = ${TENANT_A}`
    expect(raw.csd_password_encrypted).not.toContain(CSD_PASSWORD_PLAIN)

    // reemplazo: archivo viejo fuera del disco
    await mod.storeCsdFiles(
      TENANT_A,
      { fileName: 'CSD_2.cer', buffer: Buffer.from('cer-dos') },
      { fileName: 'CSD_2.key', buffer: Buffer.from('key-dos') }
    )
    expect(fs.existsSync(primerCer)).toBe(false)
    full = await mod.getFullPacSettings(TENANT_A)
    expect(fs.readFileSync(full.csdCerPath!, 'utf8')).toBe('cer-dos')
    const summary2 = await mod.getPacSummary(TENANT_A)
    expect(summary2?.csdCerFileName).toBe('CSD_2.cer')
  })

  it('deleteCsdFiles borra archivos y columnas, y es idempotente', async () => {
    const full = await mod.getFullPacSettings(TENANT_A)
    expect(await mod.deleteCsdFiles(TENANT_A)).toBe(true)
    expect(fs.existsSync(full.csdCerPath!)).toBe(false)
    expect(fs.existsSync(full.csdKeyPath!)).toBe(false)
    const summary = await mod.getPacSummary(TENANT_A)
    expect(summary?.hasCsd).toBe(false)
    expect(summary?.csdCerFileName).toBeNull()
    // la API key sobrevive (borrar el CSD no desconfigura el PAC)
    expect(summary?.hasApiKey).toBe(true)
    expect(await mod.deleteCsdFiles(TENANT_A)).toBe(false)
  })
})
