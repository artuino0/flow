import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { connectSiteForm } from '~/server/utils/sites'

const schema = z.object({
  pageId: z.string().uuid(),
  formKey: z.string().trim().min(1).max(160),
  entityId: z.string().uuid(),
  fieldMapping: z.record(z.string().min(1), z.string().min(1)).optional(),
  defaultValues: z.record(z.union([
    z.string().max(20_000),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.string().max(5_000)).max(100)
  ])).optional(),
  valueMappings: z.record(
    z.string().min(1),
    z.record(z.string().min(1), z.string().min(1))
  ).optional()
})

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const connection = await connectSiteForm(
    auth.tenantId,
    auth.sub,
    getRouterParam(event, 'siteId')!,
    await readValidatedBody(event, schema.parse)
  )
  if (!connection) throw createError({ statusCode: 404, statusMessage: 'Formulario o módulo no encontrado' })
  return connection
})
