import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { DuplicateSiteError, saveSitePageDraft } from '~/server/utils/sites'
const schema = z.object({ title: z.string().trim().min(1, 'El título es obligatorio').max(160), path: z.string().trim().min(1, 'La ruta es obligatoria').max(220), html: z.string().max(200000, 'El HTML excede el límite permitido'), css: z.string().max(100000, 'El CSS excede el límite permitido') })
export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  try {
    const page = await saveSitePageDraft(auth.tenantId, auth.sub, getRouterParam(event, 'siteId')!, getRouterParam(event, 'pageId')!, await readValidatedBody(event, schema.parse))
    if (!page) throw createError({ statusCode: 404, statusMessage: 'Página no encontrada' })
    return page
  } catch (error) {
    if (error instanceof DuplicateSiteError) throw createError({ statusCode: 409, statusMessage: error.message })
    throw error
  }
})
