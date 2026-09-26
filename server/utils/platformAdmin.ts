import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { db, withTenant } from '~/server/db'
import { people, users } from '~/server/db/schema'
import { requireAuth } from '~/server/utils/rbac'

export async function requirePlatformAdmin(event: H3Event) {
  const auth = requireAuth(event)
  const allowed = new Set((process.env.PLATFORM_ADMIN_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean))
  const membership = await withTenant(auth.tenantId, tx => tx.select({ personId: users.personId }).from(users).where(eq(users.id, auth.sub)).limit(1))
  const personId = membership[0]?.personId
  const [person] = personId ? await db.select({ email: people.email }).from(people).where(eq(people.id, personId)).limit(1) : []
  if (!person || !allowed.has(person.email.toLowerCase())) {
    throw createError({ statusCode: 403, statusMessage: 'Solo el equipo autorizado de Flow puede administrar planes.' })
  }
  return { auth, email: person.email }
}
