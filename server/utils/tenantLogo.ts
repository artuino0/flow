import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { tenants } from '~/server/db/schema'

// ERD-62 (pedido directo del usuario, 2026-09-07: "los ajustes para cargar
// el logo y los datos de la empresa emisora del reporte"): el logo del
// tenant vive en el MISMO disco local que server/utils/fileStorage.ts
// (mismo `FILES_STORAGE_DIR`/`uploads` default, misma decision ya tomada en
// ERD-78 de no sumar infraestructura nueva), pero con sus propias funciones
// en vez de reusar `storeFile`/la tabla `files` - esa tabla exige un
// `entityId` (FK a un modulo dinamico) porque esta pensada para adjuntos DE
// un registro; el logo no pertenece a ningun modulo, es UN dato del tenant
// mismo (un archivo por tenant, no una coleccion), así que vive directo en
// columnas de `tenants` (logoStorageKey/logoMimeType/logoFileName/
// logoSizeBytes) en vez de una fila en `files`.
const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024 // 2 MB - un logo no necesita mas, y mantiene la respuesta liviana para Vista previa impresión.
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])

export class LogoTooLargeError extends Error {}
export class LogoInvalidTypeError extends Error {}
export class LogoNotFoundError extends Error {}

function storageDir(): string {
  return process.env.FILES_STORAGE_DIR ? path.resolve(process.env.FILES_STORAGE_DIR) : path.resolve(process.cwd(), 'uploads')
}

// Mismo saneo que sanitizeForDisk en fileStorage.ts (duplicado a proposito -
// son 2 lineas, no vale la pena romper el aislamiento de cada util por
// compartir esto).
function sanitizeForDisk(fileName: string): string {
  const base = path.basename(fileName)
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'logo'
}

export interface TenantLogoMeta {
  fileName: string
  mimeType: string
  sizeBytes: number
}

/**
 * Guarda el logo en disco y actualiza tenants.logo* - reemplaza cualquier
 * logo anterior de este tenant (borra el archivo viejo del disco). No
 * valida permisos - eso es responsabilidad del endpoint (requireAdminRole).
 */
export async function storeTenantLogo(tenantId: string, input: { fileName: string; mimeType: string; buffer: Buffer }): Promise<TenantLogoMeta> {
  if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
    throw new LogoInvalidTypeError('El logo debe ser PNG, JPEG, WEBP o SVG')
  }
  if (input.buffer.length > MAX_LOGO_SIZE_BYTES) {
    throw new LogoTooLargeError(`El logo supera el maximo permitido de ${MAX_LOGO_SIZE_BYTES / (1024 * 1024)} MB`)
  }

  const [previous] = await db.select({ storageKey: tenants.logoStorageKey }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)

  const diskName = `logo-${randomUUID()}-${sanitizeForDisk(input.fileName)}`
  const relativeKey = path.join(tenantId, diskName)
  const fullPath = path.join(storageDir(), relativeKey)

  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, input.buffer)

  await db
    .update(tenants)
    .set({
      logoStorageKey: relativeKey,
      logoMimeType: input.mimeType,
      logoFileName: input.fileName,
      logoSizeBytes: input.buffer.length,
      updatedAt: new Date()
    })
    .where(eq(tenants.id, tenantId))

  if (previous?.storageKey) {
    fs.rmSync(path.join(storageDir(), previous.storageKey), { force: true })
  }

  return { fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.buffer.length }
}

export interface TenantLogoFile extends TenantLogoMeta {
  fullPath: string
}

/** Metadata + ruta fisica del logo actual - null si el tenant no tiene uno. */
export async function getTenantLogo(tenantId: string): Promise<TenantLogoFile | null> {
  const [row] = await db
    .select({ storageKey: tenants.logoStorageKey, mimeType: tenants.logoMimeType, fileName: tenants.logoFileName, sizeBytes: tenants.logoSizeBytes })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
  if (!row?.storageKey || !row.mimeType || !row.fileName || row.sizeBytes == null) return null
  return { fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, fullPath: path.join(storageDir(), row.storageKey) }
}

/** Borra el logo actual (columnas + archivo fisico). No falla si el tenant no tenia uno (idempotente). */
export async function deleteTenantLogo(tenantId: string): Promise<boolean> {
  const [row] = await db.select({ storageKey: tenants.logoStorageKey }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  if (!row?.storageKey) return false

  await db
    .update(tenants)
    .set({ logoStorageKey: null, logoMimeType: null, logoFileName: null, logoSizeBytes: null, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId))
  fs.rmSync(path.join(storageDir(), row.storageKey), { force: true })
  return true
}
