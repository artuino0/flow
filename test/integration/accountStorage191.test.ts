import { afterEach, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { setStoredObjectAdapter, StoredObjectNotFoundError } from '../../server/utils/objectStorage'
import { deleteAccountObject, getAccountObject, listAccountObjects } from '../../server/utils/accountStorage'
import { accountObjectKey } from '../../server/utils/accountObjectKey'

let directory: string | undefined
afterEach(async () => {
  setStoredObjectAdapter(null); delete process.env.STORAGE_DRIVER; delete process.env.FILES_STORAGE_DIR
  if (directory) {
    const target = path.resolve(directory)
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('flow-account191-')) throw new Error('Temporal fuera del directorio autorizado')
    await fs.rm(target, { recursive: true, force: true }); directory = undefined
  }
})
it('con R2 simulado exporta y borra también archivos legados del volumen sin tocar otra organización', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-account191-'))
  process.env.STORAGE_DRIVER = 'r2'; process.env.FILES_STORAGE_DIR = directory
  const tenant = randomUUID(), other = randomUUID(), key = `${tenant}/logo-legado.png`, otherKey = `${other}/logo-conservar.png`
  const remote = new Map<string, Buffer>([[`tenants/${tenant}/cfdi/factura.xml`, Buffer.from('XML-REMOTO')]])
  setStoredObjectAdapter({ get: async key => { const result = remote.get(key); if (!result) throw new StoredObjectNotFoundError('Ausente'); return result }, put: async input => { remote.set(input.key, input.body) }, delete: async key => { remote.delete(key) }, list: async prefix => [...remote.keys()].filter(key => key.startsWith(prefix)) })
  for (const file of [key, otherKey]) { await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true }); await fs.writeFile(path.join(directory, file), 'LOGO-LOCAL') }
  expect(await listAccountObjects(tenant + '/')).toEqual([key])
  expect(await getAccountObject(key)).toEqual(Buffer.from('LOGO-LOCAL'))
  expect(await listAccountObjects(`tenants/${tenant}/`)).toEqual([`tenants/${tenant}/cfdi/factura.xml`])
  expect(accountObjectKey(tenant, 'files', `${tenant}/adjunto-historico.pdf`)).toBe(`${tenant}/adjunto-historico.pdf`)
  expect(() => accountObjectKey(tenant, 'files', otherKey)).toThrow('propiedad')
  await deleteAccountObject(key); await deleteAccountObject(key)
  await expect(fs.readFile(path.join(directory, key))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await fs.readFile(path.join(directory, otherKey), 'utf8')).toBe('LOGO-LOCAL')
  await deleteAccountObject(`tenants/${tenant}/cfdi/factura.xml`)
  expect(remote.size).toBe(0)
})
