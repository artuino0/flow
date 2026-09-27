import { requireAdminRole } from '~/server/utils/rbac'
import { exportBlueprint } from '~/server/utils/blueprint/export'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  return exportBlueprint(auth.tenantId)
})
