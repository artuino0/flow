import { requireAdminRole } from '~/server/utils/rbac'
import { SiteAssetInvalidTypeError, SiteAssetTooLargeError, storeSiteAsset } from '~/server/utils/managedStorage'
import { StorageLimitExceededError } from '~/server/utils/storageUsage'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.filename)
  if (!file?.filename) throw createError({ statusCode: 422, statusMessage: 'Selecciona una imagen o fuente para subir' })
  try {
    const asset = await storeSiteAsset(auth.tenantId, getRouterParam(event, 'siteId')!, auth.sub, {
      fileName: file.filename,
      mimeType: file.type || 'application/octet-stream',
      buffer: file.data
    })
    setResponseStatus(event, 201)
    return asset
  } catch (error) {
    if (error instanceof SiteAssetInvalidTypeError) throw createError({ statusCode: 422, statusMessage: error.message })
    if (error instanceof SiteAssetTooLargeError) throw createError({ statusCode: 413, statusMessage: error.message })
    if (error instanceof StorageLimitExceededError) throw createError({ statusCode: 507, statusMessage: 'Se alcanzó el límite de almacenamiento del plan' })
    throw error
  }
})
