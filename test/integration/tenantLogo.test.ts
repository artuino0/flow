import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type {
  storeTenantLogo as StoreTenantLogo,
  getTenantLogo as GetTenantLogo,
  deleteTenantLogo as DeleteTenantLogo,
  LogoTooLargeError as LogoTooLargeErrorType,
  LogoInvalidTypeError as LogoInvalidTypeErrorType
} from '../../server/utils/tenantLogo'

// ERD-62 (pedido directo del usuario, 2026-09-07: "los ajustes para cargar
// el logo y los datos de la empresa emisora del reporte"): prueba
// server/utils/tenantLogo.ts contra un Postgres real (embedded-postgres,
// misma infraestructura de ERD-78/fileStorage.test.ts) y un directorio
// temporal real en disco.

const TENANT_A = randomUUID()
const TENANT_B = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let storageDir: string
let storeTenantLogo: typeof StoreTenantLogo
let getTenantLogo: typeof GetTenantLogo
let deleteTenantLogo: typeof DeleteTenantLogo
let LogoTooLargeError: typeof LogoTooLargeErrorType
let LogoInvalidTypeError: typeof LogoInvalidTypeErrorType

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)

  await admin`insert into tenants (id, name) values (${TENANT_A}, 'Tenant A')`
  await admin`insert into tenants (id, name) values (${TENANT_B}, 'Tenant B')`

  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erd62-logo-'))
  process.env.FILES_STORAGE_DIR = storageDir
  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ storeTenantLogo, getTenantLogo, deleteTenantLogo, LogoTooLargeError, LogoInvalidTypeError } = await import('../../server/utils/tenantLogo'))
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
  fs.rmSync(storageDir, { recursive: true, force: true })
  delete process.env.FILES_STORAGE_DIR
})

describe('tenantLogo (Postgres real + disco temporal)', () => {
  it('guarda el logo en disco y su metadata en tenants.logo*', async () => {
    const buffer = Buffer.from('contenido-de-logo-png')
    const meta = await storeTenantLogo(TENANT_A, { fileName: 'logo empresa ñ.png', mimeType: 'image/png', buffer })

    expect(meta.fileName).toBe('logo empresa ñ.png')
    expect(meta.sizeBytes).toBe(buffer.length)

    const found = await getTenantLogo(TENANT_A)
    expect(found).not.toBeNull()
    expect(fs.existsSync(found!.fullPath)).toBe(true)
    expect(fs.readFileSync(found!.fullPath, 'utf-8')).toBe('contenido-de-logo-png')
  })

  it('rechaza un tipo de archivo no permitido, sin tocar disco ni la fila', async () => {
    await expect(storeTenantLogo(TENANT_B, { fileName: 'documento.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') })).rejects.toBeInstanceOf(
      LogoInvalidTypeError
    )
    expect(await getTenantLogo(TENANT_B)).toBeNull()
  })

  it('rechaza un logo que supera el maximo de 2 MB', async () => {
    const tooBig = Buffer.alloc(2 * 1024 * 1024 + 1)
    await expect(storeTenantLogo(TENANT_B, { fileName: 'grande.png', mimeType: 'image/png', buffer: tooBig })).rejects.toBeInstanceOf(LogoTooLargeError)
    expect(await getTenantLogo(TENANT_B)).toBeNull()
  })

  it('subir un logo nuevo reemplaza el anterior (borra el archivo viejo del disco)', async () => {
    await storeTenantLogo(TENANT_B, { fileName: 'primero.png', mimeType: 'image/png', buffer: Buffer.from('v1') })
    const first = await getTenantLogo(TENANT_B)
    const firstPath = first!.fullPath

    await storeTenantLogo(TENANT_B, { fileName: 'segundo.png', mimeType: 'image/png', buffer: Buffer.from('v2') })
    const second = await getTenantLogo(TENANT_B)

    expect(second!.fileName).toBe('segundo.png')
    expect(fs.existsSync(firstPath)).toBe(false)
    expect(fs.existsSync(second!.fullPath)).toBe(true)
  })

  it('getTenantLogo no cruza tenants', async () => {
    // TENANT_A ya tiene un logo del primer test; TENANT_B tiene el suyo.
    const forA = await getTenantLogo(TENANT_A)
    const forB = await getTenantLogo(TENANT_B)
    expect(forA!.fileName).not.toBe(forB!.fileName)
  })

  it('deleteTenantLogo borra la fila y el archivo fisico, y es idempotente', async () => {
    await storeTenantLogo(TENANT_A, { fileName: 'a-borrar.png', mimeType: 'image/png', buffer: Buffer.from('borrame') })
    const found = await getTenantLogo(TENANT_A)
    expect(fs.existsSync(found!.fullPath)).toBe(true)

    expect(await deleteTenantLogo(TENANT_A)).toBe(true)
    expect(await getTenantLogo(TENANT_A)).toBeNull()
    expect(fs.existsSync(found!.fullPath)).toBe(false)

    expect(await deleteTenantLogo(TENANT_A)).toBe(false)
  })
})
