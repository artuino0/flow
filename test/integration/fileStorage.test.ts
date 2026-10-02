import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type {
  storeFile as StoreFile,
  getFile as GetFile,
  deleteFile as DeleteFile,
  FileTooLargeError as FileTooLargeErrorType,
  FileEntityNotFoundError as FileEntityNotFoundErrorType
} from '../../server/utils/fileStorage'

// HU-ERD-78: prueba server/utils/fileStorage.ts contra un Postgres real
// (embedded-postgres, misma infraestructura de HU-ERD-29) y un directorio
// temporal real en disco (FILES_STORAGE_DIR apuntando a un tmpdir propio de
// esta corrida, para no ensuciar ni depender de ./uploads del repo).

const TENANT_A = randomUUID()
const TENANT_B = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let storageDir: string
let storeFile: typeof StoreFile
let getFile: typeof GetFile
let deleteFile: typeof DeleteFile
let FileTooLargeError: typeof FileTooLargeErrorType
let FileEntityNotFoundError: typeof FileEntityNotFoundErrorType

let clientesId: string
let entityOtroTenantId: string

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)

  await admin`insert into tenants (id, name) values (${TENANT_A}, 'Tenant A')`
  const [clientes] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_A}, 'Clientes', 'clientes') returning id`
  clientesId = clientes.id as string

  await admin`insert into tenants (id, name) values (${TENANT_B}, 'Tenant B')`
  const [otro] = await admin`insert into entities (tenant_id, name, slug) values (${TENANT_B}, 'Productos', 'productos') returning id`
  entityOtroTenantId = otro.id as string

  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erd78-files-'))
  process.env.FILES_STORAGE_DIR = storageDir
  process.env.APP_DATABASE_URL = testDb.appUrl
  ;({ storeFile, getFile, deleteFile, FileTooLargeError, FileEntityNotFoundError } = await import('../../server/utils/fileStorage'))
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
  fs.rmSync(storageDir, { recursive: true, force: true })
  delete process.env.FILES_STORAGE_DIR
})

describe('fileStorage (Postgres real + disco temporal)', () => {
  it('guarda el archivo en disco y su metadata en la tabla files', async () => {
    const buffer = Buffer.from('contenido de prueba')
    const stored = await storeFile(TENANT_A, clientesId, {
      fileName: 'factura ñ 01.pdf',
      mimeType: 'application/pdf',
      buffer,
      uploadedBy: null
    })

    expect(stored.fileName).toBe('factura ñ 01.pdf') // el nombre original se conserva tal cual, acentos incluidos
    expect(stored.sizeBytes).toBe(buffer.length)

    const found = await getFile(TENANT_A, stored.id)
    expect(found).not.toBeNull()
    expect(found!.entityId).toBe(clientesId)
    expect(fs.existsSync(found!.fullPath)).toBe(true)
    expect(fs.readFileSync(found!.fullPath, 'utf-8')).toBe('contenido de prueba')
    // el nombre FISICO esta saneado (sin ñ/espacios), no el fileName original.
    expect(path.basename(found!.fullPath)).not.toContain('ñ')
  })

  it('cargas generales y administradas conservan tipos fuera del catálogo de campos', async () => {
    const { storeManagedFile, ManagedFileTooLargeError } = await import('../../server/utils/managedStorage')
    for (const [fileName, mimeType] of [
      ['antiguo.doc', 'application/msword'], ['antiguo.xls', 'application/vnd.ms-excel'],
      ['antiguo.ppt', 'application/vnd.ms-powerpoint'], ['video.mp4', 'video/mp4'],
      ['audio.mp3', 'audio/mpeg'], ['datos.xml', 'application/xml'],
      ['datos.json', 'application/json'], ['texto.rtf', 'application/rtf'],
      ['pagina.html', 'text/html'], ['desconocido.bin', 'application/octet-stream']
    ]) {
      for (const store of [storeFile, storeManagedFile]) {
        const stored = await store(TENANT_A, clientesId, { fileName, mimeType, buffer: Buffer.from('prueba'), uploadedBy: null })
        expect(stored.mimeType).toBe(mimeType)
        expect(stored.fileName).toBe(fileName)
      }
    }
    await expect(storeManagedFile(TENANT_A, clientesId, { fileName: 'grande.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(15 * 1024 * 1024 + 1), uploadedBy: null })).rejects.toBeInstanceOf(ManagedFileTooLargeError)
  })

  it('rechaza un archivo que supera el maximo de 15 MB, sin dejar nada en disco', async () => {
    const tooBig = Buffer.alloc(15 * 1024 * 1024 + 1)
    await expect(
      storeFile(TENANT_A, clientesId, { fileName: 'grande.bin', mimeType: 'application/octet-stream', buffer: tooBig, uploadedBy: null })
    ).rejects.toBeInstanceOf(FileTooLargeError)

    const entries = fs.readdirSync(storageDir, { recursive: true }) as string[]
    expect(entries.some((e) => e.includes('grande.bin'))).toBe(false)
  })

  it('rechaza un entityId que no existe en ese tenant, y no deja el archivo huerfano en disco', async () => {
    await expect(
      storeFile(TENANT_A, randomUUID(), { fileName: 'huerfano.txt', mimeType: 'text/plain', buffer: Buffer.from('x'), uploadedBy: null })
    ).rejects.toBeInstanceOf(FileEntityNotFoundError)

    // Tambien si el entityId es real pero de OTRO tenant (RLS lo esconde igual que un id inexistente).
    await expect(
      storeFile(TENANT_A, entityOtroTenantId, { fileName: 'huerfano2.txt', mimeType: 'text/plain', buffer: Buffer.from('x'), uploadedBy: null })
    ).rejects.toBeInstanceOf(FileEntityNotFoundError)

    const entries = fs.readdirSync(storageDir, { recursive: true }) as string[]
    expect(entries.some((e) => e.includes('huerfano'))).toBe(false)
  })

  it('getFile no cruza tenants (RLS)', async () => {
    const stored = await storeFile(TENANT_B, entityOtroTenantId, {
      fileName: 'de-tenant-b.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('solo tenant B'),
      uploadedBy: null
    })

    expect(await getFile(TENANT_A, stored.id)).toBeNull()
    expect(await getFile(TENANT_B, stored.id)).not.toBeNull()
  })

  it('deleteFile borra la fila y el archivo fisico, y es idempotente', async () => {
    const stored = await storeFile(TENANT_A, clientesId, {
      fileName: 'a-borrar.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('borrame'),
      uploadedBy: null
    })
    const found = await getFile(TENANT_A, stored.id)
    expect(fs.existsSync(found!.fullPath)).toBe(true)

    expect(await deleteFile(TENANT_A, stored.id)).toBe(true)
    expect(await getFile(TENANT_A, stored.id)).toBeNull()
    expect(fs.existsSync(found!.fullPath)).toBe(false)

    // Segunda vez: no existe mas, pero no explota (idempotente).
    expect(await deleteFile(TENANT_A, stored.id)).toBe(false)
  })
})
