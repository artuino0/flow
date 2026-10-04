import { StoredObjectNotFoundError } from '~/server/utils/objectStorage'
import { getPublicSiteAsset, readSiteAsset } from '~/server/utils/managedStorage'

// Ruta pública de assets para HTML/CSS publicados. tenantId + assetId se
// validan contra la tabla, por lo que nunca se expone una key cruda de R2.
export default defineEventHandler(async event => {
  const asset = await getPublicSiteAsset(getRouterParam(event, 'tenantId')!, getRouterParam(event, 'assetId')!)
  if (!asset) throw createError({ statusCode: 404, statusMessage: 'Asset no encontrado' })
  setResponseHeader(event, 'Content-Type', asset.mimeType)
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Content-Disposition', `inline; filename="${asset.fileName.replace(/"/g, '')}"`)
  setResponseHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
  setResponseHeader(event, 'Access-Control-Allow-Origin', '*')
  try { return await readSiteAsset(asset.storageKey) } catch (error) {
    if (error instanceof StoredObjectNotFoundError) throw createError({ statusCode: 404, statusMessage: 'Asset no encontrado' })
    throw error
  }
})
