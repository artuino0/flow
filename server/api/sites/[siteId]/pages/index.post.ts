import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { createSitePage, DuplicateSiteError } from '~/server/utils/sites'
import { assertPlanCapacity } from '~/server/utils/billing'
const schema = z.object({ title: z.string().trim().min(1, 'El título es obligatorio').max(160), path: z.string().trim().min(1, 'La ruta es obligatoria').max(220), kind: z.enum(['website', 'landing']).default('website') })
export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  await assertPlanCapacity(auth.tenantId, 'pages')
  try {
    const page = await createSitePage(auth.tenantId, auth.sub, getRouterParam(event, 'siteId')!, await readValidatedBody(event, schema.parse))
    if (!page) throw createError({ statusCode: 404, statusMessage: 'Sitio no encontrado' })
    return page
  } catch (error) {
    if (error instanceof DuplicateSiteError) throw createError({ statusCode: 409, statusMessage: error.message })
    throw error
  }
})
