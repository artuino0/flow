import { eq } from 'drizzle-orm'
import type { AuthTokenPayload } from '~/server/utils/auth'
import { withTenant } from '~/server/db'
import { users } from '~/server/db/schema'

// GET /api/auth/me (HU-ERD-14/15, enriquecido en HU-ERD-22): el middleware
// global ya valido el JWT (header o cookie) y dejo el payload en
// event.context.auth. Aca se suma email/fullName (no van en el JWT para no
// quedar desactualizados) para que el frontend pueda mostrar quien esta
// logueado en el header (HU-ERD-21/22).
export default defineEventHandler(async (event) => {
  const auth = event.context.auth as AuthTokenPayload

  const profile = await withTenant(auth.tenantId, async (tx) => {
    const [u] = await tx
      .select({ email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, auth.sub))
      .limit(1)
    return u ?? null
  })

  return {
    authenticated: true,
    tenantId: auth.tenantId,
    roleId: auth.roleId,
    email: profile?.email ?? null,
    fullName: profile?.fullName ?? null
  }
})
