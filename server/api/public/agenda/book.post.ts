import { defineEventHandler, setResponseStatus } from 'h3'
import { publicBookSchema } from '~/utils/agendaPublic'
import { publicAgendaBook } from '~/server/utils/agendaPublic'
import { agendaHttp, agendaHttpContext, readAgendaBody } from '~/server/utils/agendaPublicHttp'
export default defineEventHandler(event => agendaHttp(event, 'book', async () => {
  const input = publicBookSchema.parse(await readAgendaBody(event))
  const result = await publicAgendaBook(await agendaHttpContext(event, 'book', input), input)
  setResponseStatus(event, 201)
  return result
}))
