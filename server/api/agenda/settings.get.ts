import { withTenant } from '~/server/db'
import { agendaActor, agendaBaseInTx, agendaPeople, agendaSettingsInTx, requireAgendaSession } from '~/server/utils/agendaAdmin'
export default defineEventHandler(async event => {
  const auth = requireAgendaSession(event)
  return withTenant(auth.tenantId, async tx => ({ installed: !!await agendaBaseInTx(tx, auth.tenantId),
    ...await agendaSettingsInTx(tx, auth.tenantId), permissions: await agendaActor(tx, auth, auth.sub), people: await agendaPeople(tx, auth.tenantId) }))
})
