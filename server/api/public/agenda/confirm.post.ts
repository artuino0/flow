import { defineEventHandler } from 'h3'
import { publicTokenSchema } from '~/utils/agendaPublic'
import { publicAgendaConfirm } from '~/server/utils/agendaPublic'
import { agendaHttp, agendaHttpContext, readAgendaBody } from '~/server/utils/agendaPublicHttp'
export default defineEventHandler(event => agendaHttp(event, 'confirm', async () => {
  const input = publicTokenSchema.parse(await readAgendaBody(event))
  return publicAgendaConfirm(await agendaHttpContext(event, 'confirm', input), input.token)
}))
