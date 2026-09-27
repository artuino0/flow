import { discardSession, requireDesignerAccess, sessionId } from '~/server/utils/moduleDesigner/sessions'

export default defineEventHandler(async event => {
  const auth = await requireDesignerAccess(event)
  return discardSession(auth.tenantId, sessionId(event))
})
