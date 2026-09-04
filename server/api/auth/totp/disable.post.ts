import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireAuth } from '~/server/utils/rbac'
import { db, withTenant } from '~/server/db'
import { people, users } from '~/server/db/schema'
import { verifyPassword } from '~/server/utils/auth'

// POST /api/auth/totp/disable (HU-ERD-83 parte 2): apaga 2FA - exige
// reconfirmar la contraseña actual (no solo estar logueado) porque
// desactivar 2FA reduce la seguridad de la cuenta; mismo criterio que
// PUT /api/auth/password (ERD-83 parte 1) reconfirma la contraseña actual
// antes de aceptar una nueva. Limpia totpSecret ademas de apagar
// totpEnabled - reactivar 2FA despues siempre arranca de cero con
// POST /api/auth/totp/setup, nunca reutiliza un secreto viejo.
// HU multi-organizacion (2026-09-04): opera sobre `people` via person_id de
// la membresia - mismo criterio que totp/setup.post.ts.
const bodySchema = z.object({ password: z.string().min(1) })

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  const membership = await withTenant(auth.tenantId, async (tx) => {
    const [row] = await tx.select({ personId: users.personId }).from(users).where(eq(users.id, auth.sub)).limit(1)
    return row ?? null
  })
  if (!membership) {
    throw createError({ statusCode: 404, statusMessage: 'Usuario no encontrado' })
  }

  const [person] = await db.select().from(people).where(eq(people.id, membership.personId)).limit(1)
  if (!person) {
    throw createError({ statusCode: 404, statusMessage: 'Usuario no encontrado' })
  }

  const valid = await verifyPassword(body.password, person.passwordHash)
  if (!valid) {
    throw createError({ statusCode: 401, statusMessage: 'Contraseña incorrecta' })
  }

  await db.update(people).set({ totpEnabled: false, totpSecret: null, updatedAt: new Date() }).where(eq(people.id, membership.personId))

  return { enabled: false }
})
