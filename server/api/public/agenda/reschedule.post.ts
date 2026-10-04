import { defineEventHandler } from 'h3'
import { publicRescheduleSchema } from '~/utils/agendaPublic'
import { publicAgendaManage } from '~/server/utils/agendaPublic'
import { agendaHttp, agendaHttpContext, readAgendaBody } from '~/server/utils/agendaPublicHttp'
export default defineEventHandler(event => agendaHttp(event, 'reschedule', async () => {
  const input = publicRescheduleSchema.parse(await readAgendaBody(event))
  return publicAgendaManage(await agendaHttpContext(event, 'reschedule', input), input.token, input)
}))
