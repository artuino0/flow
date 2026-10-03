import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { changeAgendaClient } from '~/server/utils/agendaClient'

const schema = z.object({ entityId: z.string().uuid(), confirmed: z.boolean().default(false) }).strict()
export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, schema.parse)
  return changeAgendaClient(auth.tenantId, body.entityId, auth.sub, body.confirmed)
})
