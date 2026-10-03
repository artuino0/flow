import { saveAgendaTimeOff, requireAgendaSession } from '~/server/utils/agendaAdmin'
export default defineEventHandler(async event => saveAgendaTimeOff(requireAgendaSession(event), await readBody(event)))
