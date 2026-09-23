import { z } from 'zod'
import { setUserFlowCapabilityOverrides } from '~/server/utils/flowCapabilities'
import { requireAdminRole } from '~/server/utils/rbac'

const value = z.boolean().nullable()
const bodySchema = z.object({
  'core.access': value,
  'automation.access': value,
  'communications.access': value,
  'sites.access': value,
  'billing.access': value,
  'settings.access': value
})

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  const result = await setUserFlowCapabilityOverrides(auth.tenantId, getRouterParam(event, 'id')!, body)
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Usuario no encontrado' })
  return result
})
