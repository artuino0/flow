import { z } from 'zod'
import { createModuleDesignSession, instructionSchema, requireDesignerAccess } from '~/server/utils/moduleDesigner/sessions'
import { checkDesignerMessageRate } from '~/server/utils/moduleDesigner/rateLimit'

const bodySchema = z.object({ prompt: instructionSchema.optional() }).strict()
export default defineEventHandler(async event => {
  const auth = await requireDesignerAccess(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  if (body.prompt) await checkDesignerMessageRate(auth.tenantId, auth.sub)
  return createModuleDesignSession(auth.tenantId, auth.sub, body.prompt)
})
