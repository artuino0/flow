import { withTenant } from '~/server/db'
import { requireAuth } from '~/server/utils/rbac'
import { lookupUsers } from '~/server/utils/userField'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const users = await withTenant(auth.tenantId, tx => lookupUsers(tx, auth.tenantId))
  return { users }
})
