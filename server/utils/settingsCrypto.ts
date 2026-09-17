import crypto from 'node:crypto'

const PREFIX = 'v1'

function keyMaterial(): Buffer {
  const configured = process.env.SETTINGS_ENCRYPTION_KEY || process.env.JWT_SECRET
  if (!configured) throw new Error('Falta SETTINGS_ENCRYPTION_KEY para cifrar secretos de configuración')
  return crypto.createHash('sha256').update(configured).digest()
}

export function encryptSetting(value: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.')
}

export function decryptSetting(payload: string): string {
  const [prefix, ivRaw, tagRaw, dataRaw] = payload.split('.')
  if (prefix !== PREFIX || !ivRaw || !tagRaw || !dataRaw) throw new Error('Secreto de configuración inválido')
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyMaterial(), Buffer.from(ivRaw, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64url')), decipher.final()]).toString('utf8')
}

