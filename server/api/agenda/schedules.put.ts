import { z } from 'zod'
import { saveAgendaSchedules, requireAgendaSession } from '~/server/utils/agendaAdmin'
export default defineEventHandler(async event => {
  const auth = requireAgendaSession(event), body = await readValidatedBody(event, z.object({ userId: z.string().uuid(), schedules: z.unknown() }).parse)
  return saveAgendaSchedules(auth, body.userId, body.schedules)
})
