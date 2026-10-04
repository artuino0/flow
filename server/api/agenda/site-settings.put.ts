import { z } from 'zod'
import { agendaSiteAdministration } from '~/server/utils/agendaPublic'
import { requireAgendaSession } from '~/server/utils/agendaAdmin'
import { readAgendaBody } from '~/server/utils/agendaPublicHttp'
import { agendaSiteSettingsSchema } from '~/utils/agendaPublic'
export default defineEventHandler(async event => {
  const auth = requireAgendaSession(event)
  const input = z.object({ site: z.string().uuid(), settings: agendaSiteSettingsSchema }).strict().parse(await readAgendaBody(event))
  return agendaSiteAdministration(auth, input.site, input.settings)
})
