import { requireAgentSession, signAgentToken } from '~/server/utils/agent/security'
export default defineEventHandler(event => {
 const { auth,secret } = requireAgentSession(event,false)
 setHeader(event,'Cache-Control','no-store')
 return { token: signAgentToken(auth,secret), expiresInSec: 600 }
})
