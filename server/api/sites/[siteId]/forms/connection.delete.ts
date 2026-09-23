import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { disconnectSiteForm } from '~/server/utils/sites'

const schema = z.object({
  pageId: z.string().uuid(),
  formKey: z.string().trim().min(1).max(160)
})

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const input = await readValidatedBody(event, schema.parse)
  const removed = await disconnectSiteForm(auth.tenantId, getRouterParam(event, 'siteId')!, input.pageId, input.formKey)
  if (!removed) throw createError({ statusCode: 404, statusMessage: 'Conexión no encontrada' })
  return { ok: true }
})
