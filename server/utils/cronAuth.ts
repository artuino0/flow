import { timingSafeEqual } from 'node:crypto'
import { H3Event, createError, getHeader } from 'h3'

// En Vercel Hobby, job-queue, trigger-retries y olap-etl se disparan cada 15 min por un programador externo; al pasar a Pro, volver a agregarlos a vercel.json.

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function requireCronSecret(event: H3Event): void {
  const secret = process.env.CRON_SECRET
  if (!secret) throw createError({ statusCode: 503, statusMessage: 'CRON_SECRET no está configurado' })
  const header = getHeader(event, 'authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token || !safeEqual(token, secret)) throw createError({ statusCode: 401, statusMessage: 'No autorizado' })
}
