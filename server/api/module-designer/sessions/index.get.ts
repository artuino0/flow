import { listSessions, requireDesignerAccess } from '~/server/utils/moduleDesigner/sessions'

export default defineEventHandler(async event => {
  const auth = await requireDesignerAccess(event)
  return listSessions(auth.tenantId)
})
