import { z } from 'zod'
import { challengeCookie, clearProvisionalIntent } from '~/server/utils/provisionalRegistration'
export default defineEventHandler(async event => {
  await readValidatedBody(event, z.object({ clear: z.literal(true) }).parse)
  return clearProvisionalIntent(challengeCookie(event))
})
