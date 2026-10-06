import { z } from 'zod'
import { requireAuth } from '~/server/utils/rbac'
import { changeNavigationPin } from '~/server/utils/navigationPins'
const schema = z.object({ key: z.string().min(1).max(100), pinned: z.boolean() }).strict()
export default defineEventHandler(async event => {
  const auth = requireAuth(event), body = await readValidatedBody(event, schema.parse)
  return changeNavigationPin(auth, body.key, body.pinned)
})
