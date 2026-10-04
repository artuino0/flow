import { agendaStaffCandidates } from '~/server/utils/agendaStaff'
import { withTenant } from '~/server/db'
import { agendaActor, agendaBaseInTx, agendaPeople, agendaSettingsInTx, requireAgendaSession } from '~/server/utils/agendaAdmin'
export default defineEventHandler(async event => {
  const auth = requireAgendaSession(event)
  return withTenant(auth.tenantId, async tx => {
    const permissions = await agendaActor(tx, auth, auth.sub)
    const candidates = await agendaStaffCandidates(tx, auth.tenantId)
    return { installed: !!await agendaBaseInTx(tx, auth.tenantId), ...await agendaSettingsInTx(tx, auth.tenantId), permissions,
      people: candidates.filter(person => person.isActive && (permissions.manage || person.agendaStaff))
        .map(person => ({ id: person.id, name: person.name || person.email, agendaStaff: person.agendaStaff })) }
  })
})
