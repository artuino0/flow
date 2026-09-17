import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { getTrigger } from '~/server/utils/triggerAdmin'
import { conditionNodeSchema, evaluateCondition } from '~/server/utils/triggers'

// A simulation accepts sample values and never calls the action executor.
const bodySchema = z.object({
  triggerId: z.string().uuid(),
  condition: conditionNodeSchema,
  decisionCondition: z.union([conditionNodeSchema, z.object({}).strict()]).optional(),
  data: z.record(z.unknown()),
  previousData: z.record(z.unknown()).optional()
})

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  const trigger = await getTrigger(auth.tenantId, body.triggerId)
  if (!trigger) throw createError({ statusCode: 404, statusMessage: 'Automatización no encontrada' })
  const matches = evaluateCondition(body.condition, body.data, body.previousData)
  const parsedDecision = conditionNodeSchema.safeParse(body.decisionCondition ?? trigger.decisionCondition)
  const decision = matches && parsedDecision.success ? evaluateCondition(parsedDecision.data, body.data, body.previousData) : null
  const actions = matches ? trigger.actions.filter(action => {
    const branch = (action.config as Record<string, unknown>).branch
    return !branch || (decision !== null && branch === (decision ? 'yes' : 'no'))
  }).map(action => ({ id: action.id, actionType: action.actionType, executionOrder: action.executionOrder })) : []
  return { matches, decision, actions }
})
