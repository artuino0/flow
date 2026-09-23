import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { createSiteDomain, DuplicateDomainError } from '~/server/utils/siteDomains'
const schema = z.object({
  siteId: z.string().uuid(), hostname: z.string().trim().min(4).max(253),
  rootPageId: z.string().uuid().nullable().optional()
})
export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, schema.parse)
  try {
    const domain = await createSiteDomain(auth.tenantId, auth.sub, body)
    if (!domain) throw createError({ statusCode: 404, statusMessage: 'Sitio no encontrado' })
    setResponseStatus(event, 201)
    return domain
  } catch (error) {
    if (error instanceof DuplicateDomainError) throw createError({ statusCode: 409, statusMessage: error.message })
    throw error
  }
})