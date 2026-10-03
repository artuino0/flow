import { requireAdminRole } from '~/server/utils/rbac'
import { agendaInstallOptions } from '~/server/utils/agendaClient'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  return agendaInstallOptions(auth.tenantId)
})
