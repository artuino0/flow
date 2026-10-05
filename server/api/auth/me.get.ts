import type { AuthTokenPayload } from '~/server/utils/auth'
import { loadAuthUser } from '~/server/utils/authUser'

export default defineEventHandler(event => loadAuthUser(event.context.auth as AuthTokenPayload, Boolean(event.context.apiKeyId)))
