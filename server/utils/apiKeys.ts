import crypto from 'node:crypto'

export const API_KEY_PREFIX = 'fer_live_'

export function createApiKeyToken(tenantId: string): { token: string; prefix: string; hash: string } {
  const secret = crypto.randomBytes(32).toString('base64url')
  const token = `${API_KEY_PREFIX}${tenantId}.${secret}`
  return { token, prefix: `${API_KEY_PREFIX}${secret.slice(0, 6)}`, hash: hashApiKey(token) }
}

export function hashApiKey(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}
