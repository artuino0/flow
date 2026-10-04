import { defineEventHandler, getHeader } from 'h3'
import { publicBookingQuerySchema, publicTokenSchema } from '~/utils/agendaPublic'
import { publicAgendaBooking } from '~/server/utils/agendaPublic'
import { agendaHttp, agendaHttpContext, agendaQuery } from '~/server/utils/agendaPublicHttp'
export default defineEventHandler(event => agendaHttp(event, 'booking', async () => {
  const query = publicBookingQuerySchema.parse(agendaQuery(event))
  const input = publicTokenSchema.parse({ ...query, token: getHeader(event, 'x-flow-agenda-token') })
  return publicAgendaBooking(await agendaHttpContext(event, 'booking', input), input.token)
}))
