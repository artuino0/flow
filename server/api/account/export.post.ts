import { requireAccountAdmin } from '~/server/utils/accountLifecycle'
import { requestAccountExport } from '~/server/utils/accountExport'
export default defineEventHandler(async event => requestAccountExport((await requireAccountAdmin(event)).tenantId))
