import { requireAgendaSession } from '~/server/utils/agendaAdmin'
import { availabilityQuery, getAgendaAvailability } from '~/server/utils/agendaAvailability'
export default defineEventHandler(async event => {
  const auth = requireAgendaSession(event)
  const parsed = availabilityQuery.safeParse(getQuery(event))
  if (!parsed.success) throw createError({ statusCode: 422, statusMessage: 'Consulta inválida: elige persona, servicios y fechas válidas.' })
  return getAgendaAvailability(auth.tenantId, parsed.data)
})
