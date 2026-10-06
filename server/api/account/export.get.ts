import { requireAccountAdmin } from '~/server/utils/accountLifecycle'
import { accountExports } from '~/server/utils/accountExport'
export default defineEventHandler(async event => accountExports((await requireAccountAdmin(event)).tenantId))
