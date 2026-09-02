import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { files, entities } from '~/server/db/schema'

type Tx = typeof db

// HU-ERD-78: almacenamiento de archivos en DISCO LOCAL del propio servidor -
// decision explicita del usuario (2026-09-01, AskUserQuestion: "Disco local
// del servidor" vs. "S3 / compatible") para esta primera entrega, sin sumar
// credenciales/infraestructura nueva. Limite conocido, documentado: no
// escala a multiples instancias sin un volumen compartido - si eso hace
// falta a futuro, migrar a S3-compatible es el camino (mismo `storageKey`
// podria pasar a ser la key del bucket en vez de una ruta local).
//
// Separado de los endpoints (mismo patron que moduleEntities.ts/
// relationDefinitions.ts) para poder testearlo contra un directorio temporal
// real, sin pasar por HTTP ni por multipart/form-data.

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024 // 15 MB

function storageDir(): string {
  return process.env.FILES_STORAGE_DIR
    ? path.resolve(process.env.FILES_STORAGE_DIR)
    : path.resolve(process.cwd(), 'uploads')
}

export class FileTooLargeError extends Error {}
export class FileEntityNotFoundError extends Error {}
export class FileNotFoundError extends Error {}

export interface StoredFile {
  id: string
  entityId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  createdAt: Date
}

// Evita path traversal y caracteres problematicos en el nombre real de
// disco - el fileName ORIGINAL (con acentos, espacios, etc.) igual se guarda
// tal cual en la columna file_name, este saneo es solo para el nombre del
// archivo FISICO.
function sanitizeForDisk(fileName: string): string {
  const base = path.basename(fileName)
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'archivo'
}

// La FK files.entity_id -> entities.id por si sola NO alcanza para aislar
// tenants: entities.id es una PK global, y la comprobacion referencial de la
// FK no queda sujeta a la RLS de la sesion (confirmado con un test real -
// insertar con el entityId real de OTRO tenant no fallaba). Mismo patron ya
// usado en relationDefinitions.ts/moduleEntityFields.ts: validar con una
// consulta explicita, ANTES de escribir nada en disco.
async function assertEntityInTenant(tx: Tx, tenantId: string, entityId: string): Promise<void> {
  const [row] = await tx.select({ id: entities.id }).from(entities).where(and(eq(entities.id, entityId), eq(entities.tenantId, tenantId))).limit(1)
  if (!row) throw new FileEntityNotFoundError(`La entidad ${entityId} no existe en este tenant`)
}

/**
 * Guarda `buffer` en disco y su metadata en la tabla files. `entityId` debe
 * pertenecer al tenant - se valida explicito via assertEntityInTenant (ver
 * comentario arriba de por que la FK sola no alcanza), ANTES de tocar disco.
 * No valida permisos - eso es responsabilidad del endpoint (requiere
 * canCreate o canUpdate sobre entityId, ver server/api/files/index.post.ts).
 */
export async function storeFile(
  tenantId: string,
  entityId: string,
  input: { fileName: string; mimeType: string; buffer: Buffer; uploadedBy: string | null }
): Promise<StoredFile> {
  if (input.buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new FileTooLargeError(`El archivo supera el maximo permitido de ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`)
  }

  return withTenant(tenantId, async (tx) => {
    await assertEntityInTenant(tx, tenantId, entityId)

    const id = randomUUID()
    const diskName = `${id}-${sanitizeForDisk(input.fileName)}`
    const relativeKey = path.join(tenantId, diskName)
    const fullPath = path.join(storageDir(), relativeKey)

    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, input.buffer)

    try {
      const [row] = await tx
        .insert(files)
        .values({
          id,
          tenantId,
          entityId,
          fileName: input.fileName,
          mimeType: input.mimeType || 'application/octet-stream',
          sizeBytes: input.buffer.length,
          storageKey: relativeKey,
          uploadedBy: input.uploadedBy
        })
        .returning()
      return { id: row.id, entityId: row.entityId, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, createdAt: row.createdAt }
    } catch (err) {
      // Si el insert falla (ej. entityId no existe -> FK violation), no dejar
      // el archivo huerfano en disco.
      fs.rmSync(fullPath, { force: true })
      const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code
      if (code === '23503') {
        throw new FileEntityNotFoundError(`La entidad ${entityId} no existe en este tenant`)
      }
      throw err
    }
  })
}

export interface FileRecord extends StoredFile {
  fullPath: string
}

/** Busca la metadata de un archivo (para servirlo o borrarlo) - null si no existe en este tenant. */
export async function getFile(tenantId: string, fileId: string): Promise<FileRecord | null> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx.select().from(files).where(and(eq(files.id, fileId), eq(files.tenantId, tenantId))).limit(1)
    if (!row) return null
    return {
      id: row.id,
      entityId: row.entityId,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt,
      fullPath: path.join(storageDir(), row.storageKey)
    }
  })
}

/** Borra un archivo (fila + archivo fisico). No falla si el archivo fisico ya no estaba (idempotente). */
export async function deleteFile(tenantId: string, fileId: string): Promise<boolean> {
  const record = await getFile(tenantId, fileId)
  if (!record) return false

  await withTenant(tenantId, async (tx) => {
    await tx.delete(files).where(and(eq(files.id, fileId), eq(files.tenantId, tenantId)))
  })
  fs.rmSync(record.fullPath, { force: true })
  return true
}
