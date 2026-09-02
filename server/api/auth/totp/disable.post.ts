import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { requireAuth } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { users } from '~/server/db/schema'
import { verifyPassword } from '~/server/utils/auth'

// POST /api/auth/totp/disable (HU-ERD-83 parte 2): apaga 2FA - exige
// reconfirmar la contraseña actual (no solo estar logueado) porque
// desactivar 2FA reduce la seguridad de la cuenta; mismo criterio que
// PUT /api/auth/password (ERD-83 parte 1) reconfirma la contraseña actual
// antes de aceptar una nueva. Limpia totpSecret ademas de apagar
// totpEnabled - reactivar 2FA despues siempre arranca de cero con
// POST /api/auth/totp/setup, nunca reutiliza un secreto viejo.
const bodySchema = z.object({ password: z.string().min(1) })

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  const user = await withTenant(auth.tenantId, async (tx) => {
    const [row] = await tx.select().from(users).where(and(eq(users.id, auth.sub), eq(users.tenantId, auth.tenantId))).limit(1)
    return row ?? null
  })
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: 'Usuario no encontrado' })
  }

  const valid = await verifyPassword(body.password, user.passwordHash)
  if (!valid) {
    throw createError({ statusCode: 401, statusMessage: 'Contraseña incorrecta' })
  }

  await withTenant(auth.tenantId, async (tx) => {
    await tx.update(users).set({ totpEnabled: false, totpSecret: null, updatedAt: new Date() }).where(and(eq(users.id, auth.sub), eq(users.tenantId, auth.tenantId)))
  })

  return { enabled: false }
})
