import { challengeCookie, witnessCookie, provisionalRegistrationStatus } from '~/server/utils/provisionalRegistration'
export default defineEventHandler(event => provisionalRegistrationStatus(challengeCookie(event), witnessCookie(event)))
