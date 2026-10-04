import { z } from 'zod'
import { createOwnDefaultAgendaSchedule, requireAgendaSession } from '~/server/utils/agendaAdmin'

export default defineEventHandler(async event => {
  const auth = requireAgendaSession(event)
  // No acepta identidad ni permisos aportados por el cliente.
  await readValidatedBody(event, z.object({}).strict().parse)
  return createOwnDefaultAgendaSchedule(auth)
})
