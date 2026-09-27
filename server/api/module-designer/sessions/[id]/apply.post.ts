import { applySession, requireDesignerAccess, sessionId } from '~/server/utils/moduleDesigner/sessions'

export default defineEventHandler(async event => {
  const auth = await requireDesignerAccess(event)
  return applySession(auth.tenantId, auth.sub, sessionId(event))
})
