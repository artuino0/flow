import { z } from 'zod'
import { undoBlueprintApplication } from '~/server/utils/blueprint/undo'
import { requireDesignerAccess } from '~/server/utils/moduleDesigner/sessions'

export default defineEventHandler(async event => {
  const auth = await requireDesignerAccess(event)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const body = await readBody(event)
  const confirmPartial = z.object({ confirmPartial: z.boolean().optional() }).parse(body ?? {}).confirmPartial ?? false
  return undoBlueprintApplication(auth.tenantId, id, auth.sub, confirmPartial)
})
