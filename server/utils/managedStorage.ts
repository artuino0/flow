import { MAX_FILE_SIZE_BYTES } from '~/server/utils/fieldValidations/filePolicy'
import path from 'node:path'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { chatAttachments, chatMessages, chatParticipants, entities, files, siteAssets, sites, tenants } from '~/server/db/schema'
import { deleteStoredObject, getStoredObject, localObjectPath, putStoredObject, StoredObjectNotFoundError } from '~/server/utils/objectStorage'
import { releaseStorage, reserveStorage } from '~/server/utils/storageUsage'
import { getPublicAppBaseUrl } from '~/server/utils/publicUrls'

const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024
const MAX_SITE_ASSET_BYTES = 15 * 1024 * 1024
const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
const SITE_ASSET_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml', 'font/woff', 'font/woff2', 'application/font-woff', 'application/font-woff2'])

// Antes de R2, tenantLogo.ts guardaba los logos en uploads/{tenantId}/logo-...
// y usaba path.join: en Windows la clave persistida contiene backslashes.
// Las claves nuevas siempre empiezan con tenants/ y siguen STORAGE_DRIVER.
function legacyLocalLogoPath(storageKey: string): string | null {
  const normalized = storageKey.replaceAll('\\', '/')
  if (!/^[0-9a-f-]{36}\/logo-[a-zA-Z0-9._-]+$/i.test(normalized)) return null
  return localObjectPath(normalized)
}

async function readTenantLogoObject(storageKey: string): Promise<Buffer> {
  const legacyPath = legacyLocalLogoPath(storageKey)
  if (!legacyPath) return getStoredObject(storageKey)
  try { return await fs.readFile(legacyPath) } catch (error: any) {
    if (error?.code === 'ENOENT') throw new StoredObjectNotFoundError('Logo no encontrado')
    throw error
  }
}

async function deleteTenantLogoObject(storageKey: string): Promise<void> {
  const legacyPath = legacyLocalLogoPath(storageKey)
  if (legacyPath) await fs.rm(legacyPath, { force: true })
  else await deleteStoredObject(storageKey)
}

export class ManagedFileTooLargeError extends Error {}
export class ManagedLogoTooLargeError extends Error {}
export class ManagedLogoInvalidTypeError extends Error {}
export class SiteAssetInvalidTypeError extends Error {}
export class SiteAssetTooLargeError extends Error {}

function safeName(value: string) {
  return path.basename(value).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'archivo'
}
function key(tenantId: string, area: string, id: string, fileName: string) {
  return `tenants/${tenantId}/${area}/${id}-${safeName(fileName)}`
}
function legacyChatKey(value: string) { return value.startsWith('tenants/') ? value : `chat/${value}` }
async function removeAfterFailedInsert(tenantId: string, storageKey: string, sizeBytes: number) {
  await deleteStoredObject(storageKey).catch(() => undefined)
  await releaseStorage(tenantId, sizeBytes)
}

export async function storeManagedFile(tenantId: string, entityId: string, input: { fileName: string; mimeType: string; buffer: Buffer; uploadedBy: string | null }) {
  if (input.buffer.length > MAX_FILE_SIZE_BYTES) throw new ManagedFileTooLargeError(`El archivo supera el máximo permitido de ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`)
  return withTenant(tenantId, async tx => {
    const [entity] = await tx.select({ id: entities.id }).from(entities).where(and(eq(entities.id, entityId), eq(entities.tenantId, tenantId))).limit(1)
    if (!entity) throw createError({ statusCode: 422, statusMessage: 'La entidad no existe en este tenant' })
    const id = randomUUID()
    const storageKey = key(tenantId, 'files', id, input.fileName)
    await reserveStorage(tenantId, input.buffer.length)
    try {
      await putStoredObject({ key: storageKey, body: input.buffer, contentType: input.mimeType })
      const [row] = await tx.insert(files).values({ id, tenantId, entityId, fileName: input.fileName, mimeType: input.mimeType || 'application/octet-stream', sizeBytes: input.buffer.length, storageKey, uploadedBy: input.uploadedBy }).returning()
      return { id: row.id, entityId: row.entityId, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, createdAt: row.createdAt }
    } catch (error) {
      await removeAfterFailedInsert(tenantId, storageKey, input.buffer.length)
      throw error
    }
  })
}

export async function getManagedFile(tenantId: string, fileId: string) {
  return withTenant(tenantId, async tx => {
    const [row] = await tx.select().from(files).where(and(eq(files.id, fileId), eq(files.tenantId, tenantId))).limit(1)
    return row ?? null
  })
}
export async function readManagedFile(tenantId: string, storageKey: string) {
  const normalized = storageKey.replaceAll('\\', '/')
  const legacyPrefix = `${tenantId}/`
  if (!normalized.startsWith(`tenants/${tenantId}/files/`) && !normalized.startsWith(`tenants/${tenantId}/records/`) && !normalized.startsWith(legacyPrefix)) throw new StoredObjectNotFoundError('Archivo no encontrado')
  return getStoredObject(normalized)
}
export async function deleteManagedFile(tenantId: string, fileId: string) {
  const file = await getManagedFile(tenantId, fileId)
  if (!file) return false
  await withTenant(tenantId, async tx => { await tx.delete(files).where(and(eq(files.id, fileId), eq(files.tenantId, tenantId))) })
  await deleteStoredObject(file.storageKey.replaceAll('\\', '/')).catch(error => { if (!(error instanceof StoredObjectNotFoundError)) throw error })
  await releaseStorage(tenantId, file.sizeBytes)
  return true
}

export async function storeManagedChatAttachment(tenantId: string, userId: string, input: { fileName: string; mimeType: string; data: Buffer }) {
  if (input.data.length > MAX_FILE_SIZE_BYTES) throw new ManagedFileTooLargeError(`El archivo supera el máximo permitido de ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`)
  const id = randomUUID()
  const storageKey = key(tenantId, 'chat', id, input.fileName)
  await reserveStorage(tenantId, input.data.length)
  try {
    await putStoredObject({ key: storageKey, body: input.data, contentType: input.mimeType })
    return await withTenant(tenantId, async tx => {
      const [row] = await tx.insert(chatAttachments).values({ id, tenantId, uploadedBy: userId, fileName: input.fileName, mimeType: input.mimeType || 'application/octet-stream', sizeBytes: input.data.length, storageKey }).returning()
      return { id: row.id, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, url: `/api/chat/attachments/${row.id}` }
    })
  } catch (error) {
    await removeAfterFailedInsert(tenantId, storageKey, input.data.length)
    throw error
  }
}

export async function getManagedChatAttachment(tenantId: string, userId: string, id: string) {
  return withTenant(tenantId, async tx => {
    const [row] = await tx.select().from(chatAttachments).where(and(eq(chatAttachments.id, id), eq(chatAttachments.tenantId, tenantId))).limit(1)
    if (!row) return null
    if (row.uploadedBy !== userId) {
      if (!row.messageId) return null
      const [message] = await tx.select({ conversationId: chatMessages.conversationId }).from(chatMessages).where(eq(chatMessages.id, row.messageId)).limit(1)
      if (!message) return null
      const [member] = await tx.select({ id: chatParticipants.id }).from(chatParticipants).where(and(eq(chatParticipants.conversationId, message.conversationId), eq(chatParticipants.userId, userId))).limit(1)
      if (!member) return null
    }
    return row
  })
}
export async function readManagedChatAttachment(storageKey: string) { return getStoredObject(legacyChatKey(storageKey)) }

export async function storeManagedTenantLogo(tenantId: string, input: { fileName: string; mimeType: string; buffer: Buffer }) {
  if (!LOGO_TYPES.has(input.mimeType)) throw new ManagedLogoInvalidTypeError('El logo debe ser PNG, JPEG, WEBP o SVG')
  if (input.buffer.length > MAX_LOGO_SIZE_BYTES) throw new ManagedLogoTooLargeError(`El logo supera el máximo permitido de ${MAX_LOGO_SIZE_BYTES / (1024 * 1024)} MB`)
  const [previous] = await db.select({ storageKey: tenants.logoStorageKey, sizeBytes: tenants.logoSizeBytes }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  const storageKey = key(tenantId, 'branding', randomUUID(), input.fileName)
  await reserveStorage(tenantId, input.buffer.length)
  try {
    await putStoredObject({ key: storageKey, body: input.buffer, contentType: input.mimeType, cacheControl: 'public, max-age=86400' })
    await db.update(tenants).set({ logoStorageKey: storageKey, logoMimeType: input.mimeType, logoFileName: input.fileName, logoSizeBytes: input.buffer.length, updatedAt: new Date() }).where(eq(tenants.id, tenantId))
  } catch (error) {
    await removeAfterFailedInsert(tenantId, storageKey, input.buffer.length)
    throw error
  }
  if (previous?.storageKey) {
    await deleteTenantLogoObject(previous.storageKey).catch(() => undefined)
    await releaseStorage(tenantId, previous.sizeBytes ?? 0)
  }
  return { fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.buffer.length }
}

export interface ManagedTenantLogo {
  storageKey: string
  mimeType: string
  fileName: string
  sizeBytes: number
}

export async function getManagedTenantLogo(tenantId: string): Promise<ManagedTenantLogo | null> {
  const [row] = await db.select({ storageKey: tenants.logoStorageKey, mimeType: tenants.logoMimeType, fileName: tenants.logoFileName, sizeBytes: tenants.logoSizeBytes }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  if (!row?.storageKey || !row.mimeType || !row.fileName || row.sizeBytes == null) return null
  return { storageKey: row.storageKey, mimeType: row.mimeType, fileName: row.fileName, sizeBytes: row.sizeBytes }
}
export async function deleteManagedTenantLogo(tenantId: string) {
  const logo = await getManagedTenantLogo(tenantId)
  if (!logo) return false
  await db.update(tenants).set({ logoStorageKey: null, logoMimeType: null, logoFileName: null, logoSizeBytes: null, updatedAt: new Date() }).where(eq(tenants.id, tenantId))
  await deleteTenantLogoObject(logo.storageKey).catch(() => undefined)
  await releaseStorage(tenantId, logo.sizeBytes)
  return true
}
export async function readManagedTenantLogo(storageKey: string) { return readTenantLogoObject(storageKey) }
export function managedTenantLogoUrl(tenantId: string) { return `${getPublicAppBaseUrl()}/api/public/tenant/${tenantId}/logo` }

export async function storeSiteAsset(tenantId: string, siteId: string, userId: string, input: { fileName: string; mimeType: string; buffer: Buffer }) {
  if (!SITE_ASSET_TYPES.has(input.mimeType)) throw new SiteAssetInvalidTypeError('Solo puedes subir imágenes SVG/WEBP/PNG/JPEG/GIF/AVIF o fuentes WOFF/WOFF2')
  if (input.buffer.length > MAX_SITE_ASSET_BYTES) throw new SiteAssetTooLargeError(`El asset supera el máximo permitido de ${MAX_SITE_ASSET_BYTES / (1024 * 1024)} MB`)
  const id = randomUUID()
  const storageKey = key(tenantId, `sites/${siteId}/assets`, id, input.fileName)
  await withTenant(tenantId, async tx => {
    const [site] = await tx.select({ id: sites.id }).from(sites).where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId))).limit(1)
    if (!site) throw createError({ statusCode: 404, statusMessage: 'Sitio no encontrado' })
  })
  await reserveStorage(tenantId, input.buffer.length)
  try {
    await putStoredObject({ key: storageKey, body: input.buffer, contentType: input.mimeType, cacheControl: 'public, max-age=31536000, immutable' })
    return await withTenant(tenantId, async tx => {
      const [asset] = await tx.insert(siteAssets).values({ id, tenantId, siteId, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.buffer.length, storageKey, uploadedBy: userId }).returning()
      return { id: asset.id, fileName: asset.fileName, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, createdAt: asset.createdAt, publicUrl: `${getPublicAppBaseUrl()}/site-assets/${tenantId}/${asset.id}` }
    })
  } catch (error) {
    await removeAfterFailedInsert(tenantId, storageKey, input.buffer.length)
    throw error
  }
}
export async function listSiteAssets(tenantId: string, siteId: string) {
  return withTenant(tenantId, async tx => {
    const rows = await tx.select().from(siteAssets).where(and(eq(siteAssets.tenantId, tenantId), eq(siteAssets.siteId, siteId))).orderBy(siteAssets.createdAt)
    return rows.map(asset => ({ id: asset.id, fileName: asset.fileName, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, createdAt: asset.createdAt, publicUrl: `${getPublicAppBaseUrl()}/site-assets/${tenantId}/${asset.id}` }))
  })
}
export async function getPublicSiteAsset(tenantId: string, assetId: string) {
  return withTenant(tenantId, async tx => {
    const [asset] = await tx.select().from(siteAssets).where(and(eq(siteAssets.id, assetId), eq(siteAssets.tenantId, tenantId))).limit(1)
    return asset ?? null
  })
}
export async function readSiteAsset(storageKey: string) { return getStoredObject(storageKey) }


