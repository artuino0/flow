import { requirePlatformAdmin } from '~/server/utils/platformAdmin'
import { changeAccountPolicy } from '~/server/utils/accountPlatform'
export default defineEventHandler(async event => { await requirePlatformAdmin(event); return changeAccountPolicy(await readBody(event)) })
