import { z } from 'zod'
import { agendaSiteAdministration } from '~/server/utils/agendaPublic'
import { requireAgendaSession } from '~/server/utils/agendaAdmin'
export default defineEventHandler(async event => {
  const auth = requireAgendaSession(event)
  const input = z.object({ site: z.string().uuid() }).strict().parse(getQuery(event))
  return agendaSiteAdministration(auth, input.site)
})
