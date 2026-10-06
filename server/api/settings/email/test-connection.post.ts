import { resolveMailTransport } from '~/server/utils/mailTransport'
import { requireAdminRole } from '~/server/utils/rbac'

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const { transport } = await resolveMailTransport(auth.tenantId)
  const status = await transport.check()
  if (status.status !== 'ok') throw createError({ statusCode: 422, statusMessage: status.reason })
  return { ok: true, source: 'database', provider: transport.name, checked: 'configuration' }
})

