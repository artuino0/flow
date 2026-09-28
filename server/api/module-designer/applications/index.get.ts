import { listBlueprintApplications } from '~/server/utils/blueprint/undo'
import { requireDesignerAccess } from '~/server/utils/moduleDesigner/sessions'

export default defineEventHandler(async event => {
  const auth = await requireDesignerAccess(event)
  return listBlueprintApplications(auth.tenantId)
})
