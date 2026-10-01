export function useAgentSession() {
 const token = useState('agent-session-token', () => ({ value: '', expiresAt: 0, identity: '' }))
 const { user } = useAuth()
 async function headers() {
  const identity = `${user.value?.tenantId}:${user.value?.id}:${user.value?.sessionId}`
  if (token.value.identity !== identity || token.value.expiresAt <= Date.now()) {
   const session = await $fetch<{ token: string; expiresInSec: number }>('/api/agent/session')
   token.value = { value: session.token, expiresAt: Date.now()+(session.expiresInSec-30)*1000, identity }
  }
  return { 'X-Agent-Token': token.value.value }
 }
 return { headers }
}
