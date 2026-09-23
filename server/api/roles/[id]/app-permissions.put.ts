import { z } from 'zod'
import { setRoleFlowCapabilities } from '~/server/utils/flowCapabilities'
import { requireAdminRole } from '~/server/utils/rbac'

const bodySchema = z.object({
  'core.access': z.boolean(),
  'automation.access': z.boolean(),
  'communications.access': z.boolean(),
  'sites.access': z.boolean(),
  'billing.access': z.boolean(),
  'settings.access': z.boolean()
})

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  const result = await setRoleFlowCapabilities(auth.tenantId, getRouterParam(event, 'id')!, body)
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Rol no encontrado' })
  return result
})
