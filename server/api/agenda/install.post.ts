import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { installAgendaTemplate } from '~/server/utils/agendaTemplate'

const schema = z.discriminatedUnion('mode', [z.object({ mode: z.literal('create') }).strict(), z.object({ mode: z.literal('link'), entityId: z.string().uuid() }).strict()])
export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const choice = await readValidatedBody(event, schema.parse)
  return installAgendaTemplate(auth.tenantId, choice)
})
