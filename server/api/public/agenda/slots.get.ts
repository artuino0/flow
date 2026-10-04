import { defineEventHandler } from 'h3'
import { publicSlotsSchema } from '~/utils/agendaPublic'
import { publicAgendaSlots } from '~/server/utils/agendaPublic'
import { agendaHttp, agendaHttpContext, agendaQuery } from '~/server/utils/agendaPublicHttp'
export default defineEventHandler(event => agendaHttp(event, 'slots', async () => {
  const input = publicSlotsSchema.parse(agendaQuery(event))
  return publicAgendaSlots(await agendaHttpContext(event, 'slots', input), input)
}))
