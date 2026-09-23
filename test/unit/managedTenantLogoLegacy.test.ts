import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readManagedTenantLogo } from '../../server/utils/managedStorage'

const previousStorageDir = process.env.FILES_STORAGE_DIR
const previousDriver = process.env.STORAGE_DRIVER
let tempDir: string | undefined

afterEach(async () => {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
  if (previousStorageDir === undefined) delete process.env.FILES_STORAGE_DIR
  else process.env.FILES_STORAGE_DIR = previousStorageDir
  if (previousDriver === undefined) delete process.env.STORAGE_DRIVER
  else process.env.STORAGE_DRIVER = previousDriver
})

describe('logo de tenant en disco local', () => {
  it('lee una clave antigua de Windows aunque R2 esté seleccionado', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-legacy-logo-'))
    process.env.FILES_STORAGE_DIR = tempDir
    process.env.STORAGE_DRIVER = 'r2'
    const tenantId = randomUUID()
    const filename = 'logo-legacy-Group.png'
    const folder = path.join(tempDir, tenantId)
    await fs.mkdir(folder)
    await fs.writeFile(path.join(folder, filename), Buffer.from('logo antiguo'))

    const logo = await readManagedTenantLogo(`${tenantId}\\${filename}`)
    expect(logo.toString()).toBe('logo antiguo')
  })

  it('lee un logo nuevo con el proveedor local usado on premise', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-local-logo-'))
    process.env.FILES_STORAGE_DIR = tempDir
    process.env.STORAGE_DRIVER = 'local'
    const tenantId = randomUUID()
    const key = `tenants/${tenantId}/branding/logo.png`
    const folder = path.join(tempDir, 'tenants', tenantId, 'branding')
    await fs.mkdir(folder, { recursive: true })
    await fs.writeFile(path.join(folder, 'logo.png'), Buffer.from('logo nuevo'))

    const logo = await readManagedTenantLogo(key)
    expect(logo.toString()).toBe('logo nuevo')
  })
})
