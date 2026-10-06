import fs from 'node:fs/promises'
import path from 'node:path'
import { deleteStoredObject, getStoredObject, listStoredObjects, localObjectPath, usingR2 } from './objectStorage'

/** También cubre el volumen histórico cuando el almacenamiento actual es R2.
 * Un enlace simbólico no puede convertir una clave propia en un archivo ajeno. */
async function localPath(key: string) {
  const target = localObjectPath(key), root = path.dirname(localObjectPath('account-storage-root'))
  try {
    const [realRoot, realParent] = await Promise.all([fs.realpath(root), fs.realpath(path.dirname(target))])
    const expected = path.resolve(realRoot, ...key.split('/').slice(0, -1))
    if (realParent.toLowerCase() !== expected.toLowerCase()) throw new Error('El almacenamiento histórico contiene un enlace fuera del prefijo de propiedad')
    const stat = await fs.lstat(target)
    if (stat.isSymbolicLink()) throw new Error('No se admite un enlace simbólico en almacenamiento histórico')
  } catch (error: any) { if (error?.code !== 'ENOENT') throw error }
  return target
}
export async function getAccountObject(key: string): Promise<Buffer> {
  try { return await getStoredObject(key) }
  catch (error) {
    if (!usingR2()) throw error
    // El archivo legado puede seguir en el volumen, aunque ya se use R2.
    try { return await fs.readFile(await localPath(key)) } catch { throw error }
  }
}
export async function deleteAccountObject(key: string) {
  if (usingR2()) await fs.rm(await localPath(key), { force: true })
  await deleteStoredObject(key)
}
export async function listAccountObjects(prefix: string) {
  const managed = await listStoredObjects(prefix)
  if (!usingR2()) return managed
  const local: string[] = []
  const walk = async (key: string) => {
    const target = await localPath(key.replace(/\/$/, ''))
    let entries
    try { entries = await fs.readdir(target, { withFileTypes: true }) }
    catch (error: any) { if (error?.code === 'ENOENT') return; throw error }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error('No se admite un enlace simbólico en almacenamiento histórico')
      const child = key + entry.name
      if (entry.isDirectory()) await walk(child + '/')
      else if (entry.isFile()) local.push(child)
    }
  }
  await walk(prefix)
  return [...new Set([...managed, ...local])]
}
