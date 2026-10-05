import { z } from 'zod'
import { siteVerificationSchema } from '~/utils/siteSeo'
import { requireAdminRole } from '~/server/utils/rbac'
import { DuplicateSiteError, SITE_SLUG_PATTERN, updateSite } from '~/server/utils/sites'

const schema = z.object({
  name: z.string().trim().min(2, 'El nombre es obligatorio').max(120),
  slug: z.string().trim().regex(SITE_SLUG_PATTERN, 'Usa minúsculas, números y guiones'),
  locale: z.string().trim().min(2).max(16),
  searchVerification: siteVerificationSchema.optional()
})

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  try {
    const site = await updateSite(auth.tenantId, getRouterParam(event, 'siteId')!, await readValidatedBody(event, schema.parse))
    if (!site) throw createError({ statusCode: 404, statusMessage: 'Sitio no encontrado' })
    return site
  } catch (error) {
    if (error instanceof DuplicateSiteError) throw createError({ statusCode: 409, statusMessage: error.message })
    throw error
  }
})
