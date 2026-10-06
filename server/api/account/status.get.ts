import { accountLifecycle } from '~/server/utils/accountLifecycle'
import { requireAuth } from '~/server/utils/rbac'
export default defineEventHandler(async event => ({ account: await accountLifecycle(requireAuth(event).tenantId) }))
