import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { withTenant } from '~/server/db'
import { people, users } from '~/server/db/schema'
import { requireAuth } from '~/server/utils/rbac'

const profileSchema = z.object({
  fullName: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(40).nullable().optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  timezone: z.string().trim().min(1).max(80).nullable().optional()
})

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const body = await readValidatedBody(event, profileSchema.parse)
  if (body.timezone) {
    try { new Intl.DateTimeFormat('es-MX', { timeZone: body.timezone }) } catch { throw createError({ statusCode: 400, statusMessage: 'Zona horaria inválida' }) }
  }
  await withTenant(auth.tenantId, async (tx) => {
    const [membership] = await tx.select({ personId: users.personId }).from(users).where(eq(users.id, auth.sub)).limit(1)
    if (!membership) throw createError({ statusCode: 404, statusMessage: 'Membresía no encontrada' })
    await tx.update(people).set({ fullName: body.fullName, phone: body.phone ?? null, updatedAt: new Date() }).where(eq(people.id, membership.personId))
    await tx.update(users).set({ jobTitle: body.jobTitle ?? null, timezone: body.timezone ?? null, updatedAt: new Date() }).where(eq(users.id, auth.sub))
  })
  return { ok: true }
})
