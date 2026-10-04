import { defineEventHandler } from 'h3'
import { publicTokenSchema } from '~/utils/agendaPublic'
import { publicAgendaManage } from '~/server/utils/agendaPublic'
import { agendaHttp, agendaHttpContext, readAgendaBody } from '~/server/utils/agendaPublicHttp'
export default defineEventHandler(event => agendaHttp(event, 'cancel', async () => {
  const input = publicTokenSchema.parse(await readAgendaBody(event))
  return publicAgendaManage(await agendaHttpContext(event, 'cancel', input), input.token)
}))
