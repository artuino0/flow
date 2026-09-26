import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { createSite, DuplicateSiteError, SITE_SLUG_PATTERN } from '~/server/utils/sites'
import { assertPlanCapacity } from '~/server/utils/billing'
const schema = z.object({ name: z.string().trim().min(2, 'El nombre es obligatorio').max(120), slug: z.string().trim().regex(SITE_SLUG_PATTERN, 'Usa minúsculas, números y guiones'), locale: z.string().trim().min(2).max(16).optional() })
export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, schema.parse)
  await assertPlanCapacity(auth.tenantId, 'sites')
  try {
    const site = await createSite(auth.tenantId, auth.sub, body)
    setResponseStatus(event, 201)
    return site
  } catch (error) {
    if (error instanceof DuplicateSiteError) throw createError({ statusCode: 409, statusMessage: error.message })
    throw error
  }
})
