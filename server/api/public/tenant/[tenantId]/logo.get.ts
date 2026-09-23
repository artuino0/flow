import { StoredObjectNotFoundError } from '~/server/utils/objectStorage'
import { getManagedTenantLogo, readManagedTenantLogo } from '~/server/utils/managedStorage'

// Los logos son identidad pública del tenant: se usan en correos y sitios.
// No se expone storageKey ni se permite navegar otros archivos del bucket.
export default defineEventHandler(async event => {
  const tenantId = getRouterParam(event, 'tenantId')!
  const logo = await getManagedTenantLogo(tenantId)
  if (!logo) throw createError({ statusCode: 404, statusMessage: 'Logo no encontrado' })
  setResponseHeader(event, 'Content-Type', logo.mimeType)
  setResponseHeader(event, 'Content-Disposition', `inline; filename="${logo.fileName.replace(/"/g, '')}"`)
  setResponseHeader(event, 'Cache-Control', 'public, max-age=3600, s-maxage=86400')
  try { return await readManagedTenantLogo(logo.storageKey) } catch (error) {
    if (error instanceof StoredObjectNotFoundError) throw createError({ statusCode: 404, statusMessage: 'Logo no encontrado' })
    throw error
  }
})
