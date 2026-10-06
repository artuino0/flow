import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

export function verificationHash(id: string, code: string): string {
  const secret = process.env.EMAIL_VERIFICATION_SECRET || process.env.JWT_SECRET
  if (!secret) throw new Error('Falta el secreto estable de verificación de correo')
  return createHmac('sha256', secret).update(`flow:email:195:${id}:${code}`).digest('hex')
}
export function newVerificationCode() { return randomInt(0, 1_000_000).toString().padStart(6, '0') }
export function matchesVerificationCode(id: string, code: string, hash: string) {
  return /^\d{6}$/.test(code) && /^[a-f0-9]{64}$/.test(hash)
    && timingSafeEqual(Buffer.from(verificationHash(id, code), 'hex'), Buffer.from(hash, 'hex'))
}
