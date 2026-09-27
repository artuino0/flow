import { editSessionBlueprint, requireDesignerAccess, sessionId } from '~/server/utils/moduleDesigner/sessions'

export default defineEventHandler(async event => {
  const auth = await requireDesignerAccess(event)
  return editSessionBlueprint(auth.tenantId, sessionId(event), await readBody(event))
})
