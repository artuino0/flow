import { requirePlatformAdmin } from '~/server/utils/platformAdmin'
import { listAccountLifecycle } from '~/server/utils/accountPlatform'
export default defineEventHandler(async event => { await requirePlatformAdmin(event); return listAccountLifecycle() })
