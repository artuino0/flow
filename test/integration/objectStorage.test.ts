import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deleteStoredObject, getStoredObject, putStoredObject, setStoredObjectAdapter, StoredObjectNotFoundError, type StoredObjectAdapter } from '../../server/utils/objectStorage'

afterEach(() => {
  setStoredObjectAdapter(null)
  delete process.env.STORAGE_DRIVER
  delete process.env.FILES_STORAGE_DIR
})

describe('objectStorage', () => {
  it('local guarda, lee y borra objetos', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'erd98-local-'))
    process.env.STORAGE_DRIVER = 'local'
    process.env.FILES_STORAGE_DIR = dir
    try {
      await putStoredObject({ key: 'tenants/a/files/test.txt', body: Buffer.from('local') })
      expect(await getStoredObject('tenants/a/files/test.txt')).toEqual(Buffer.from('local'))
      await deleteStoredObject('tenants/a/files/test.txt')
      await expect(getStoredObject('tenants/a/files/test.txt')).rejects.toBeInstanceOf(StoredObjectNotFoundError)
    } finally { await fs.rm(dir, { recursive: true, force: true }) }
  })

  it('el adaptador remoto en memoria respeta claves y aislamiento de tenant', async () => {
    const objects = new Map<string, Buffer>()
    const memory: StoredObjectAdapter = {
      async put({ key, body }) { objects.set(key, Buffer.from(body)) },
      async get(key) {
        const value = objects.get(key)
        if (!value) throw new StoredObjectNotFoundError('Archivo no encontrado')
        return Buffer.from(value)
      },
      async delete(key) { objects.delete(key) }
    }
    setStoredObjectAdapter(memory)
    const tenantA = 'tenant-a'
    const tenantB = 'tenant-b'
    const keyA = `tenants/${tenantA}/cfdi/document.xml`
    await putStoredObject({ key: keyA, body: Buffer.from('<xml/>') })
    expect(await getStoredObject(keyA)).toEqual(Buffer.from('<xml/>'))
    expect(objects.has(`tenants/${tenantB}/cfdi/document.xml`)).toBe(false)
    await deleteStoredObject(keyA)
    expect(objects.has(keyA)).toBe(false)
  })
})
