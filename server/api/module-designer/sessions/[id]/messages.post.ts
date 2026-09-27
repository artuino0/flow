import { z } from 'zod'
import { generateDesign } from '~/server/utils/moduleDesigner/generate'
import { checkDesignerMessageRate } from '~/server/utils/moduleDesigner/rateLimit'
import { instructionSchema, requireDesignerAccess, sessionId } from '~/server/utils/moduleDesigner/sessions'

const bodySchema = z.object({ instruction: instructionSchema }).strict()
export default defineEventHandler(async event => {
  const auth = await requireDesignerAccess(event)
  const id = sessionId(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  await checkDesignerMessageRate(auth.tenantId, auth.sub)
  return generateDesign(auth.tenantId, id, body.instruction)
})
