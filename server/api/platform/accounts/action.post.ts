import { requirePlatformAdmin } from '~/server/utils/platformAdmin'
import { changeAccountLifecycle } from '~/server/utils/accountPlatform'
export default defineEventHandler(async event => { await requirePlatformAdmin(event); return changeAccountLifecycle(await readBody(event)) })
