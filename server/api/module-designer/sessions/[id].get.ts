import { findSession, requireDesignerAccess, sessionId } from '~/server/utils/moduleDesigner/sessions'

export default defineEventHandler(async event => {
  const auth = await requireDesignerAccess(event)
  return findSession(auth.tenantId, sessionId(event))
})
