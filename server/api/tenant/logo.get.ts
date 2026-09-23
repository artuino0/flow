import { StoredObjectNotFoundError } from '~/server/utils/objectStorage'
import { requireAuth } from '~/server/utils/rbac'
import { getManagedTenantLogo, readManagedTenantLogo } from '~/server/utils/managedStorage'

export default defineEventHandler(async event => {
  const auth = requireAuth(event)
  const logo = await getManagedTenantLogo(auth.tenantId)
  if (!logo) throw createError({ statusCode: 404, statusMessage: 'Este tenant todavía no tiene un logo cargado' })
  setResponseHeader(event, 'Content-Type', logo.mimeType)
  setResponseHeader(event, 'Content-Disposition', `inline; filename="${logo.fileName.replace(/"/g, '')}"`)
  setResponseHeader(event, 'Cache-Control', 'private, max-age=300')
  try { return await readManagedTenantLogo(logo.storageKey) } catch (error) {
    if (error instanceof StoredObjectNotFoundError) throw createError({ statusCode: 404, statusMessage: 'El logo ya no existe en almacenamiento' })
    throw error
  }
})
