import { requireAdminRole } from '~/server/utils/rbac'
import { ManagedLogoInvalidTypeError, ManagedLogoTooLargeError, storeManagedTenantLogo } from '~/server/utils/managedStorage'
import { StorageLimitExceededError } from '~/server/utils/storageUsage'
import { invalidateTenantAccess } from '~/server/utils/shortCache'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const parts = await readMultipartFormData(event)
  const filePart = parts?.find(part => part.filename)
  if (!filePart?.filename) throw createError({ statusCode: 422, statusMessage: 'No se recibió ningún archivo' })
  try {
    const logo = await storeManagedTenantLogo(auth.tenantId, { fileName: filePart.filename, mimeType: filePart.type ?? 'application/octet-stream', buffer: filePart.data })
    invalidateTenantAccess(auth.tenantId)
    setResponseStatus(event, 201)
    return logo
  } catch (error) {
    if (error instanceof ManagedLogoTooLargeError) throw createError({ statusCode: 413, statusMessage: error.message })
    if (error instanceof ManagedLogoInvalidTypeError) throw createError({ statusCode: 422, statusMessage: error.message })
    if (error instanceof StorageLimitExceededError) throw createError({ statusCode: 507, statusMessage: 'No hay espacio disponible para subir el logo' })
    throw error
  }
})
