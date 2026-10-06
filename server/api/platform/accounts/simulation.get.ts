import { z } from 'zod'
import { requirePlatformAdmin } from '~/server/utils/platformAdmin'
import { simulateAccountLifecycle } from '~/server/utils/accountPlatform'
const querySchema = z.object({ at: z.string().datetime().optional() }).strict()
export default defineEventHandler(async event => {
  await requirePlatformAdmin(event)
  const query = querySchema.parse(getQuery(event))
  return simulateAccountLifecycle(query.at ? new Date(query.at) : new Date())
})
