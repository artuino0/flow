import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireAuth } from '~/server/utils/rbac'
import { db, withTenant } from '~/server/db'
import { people, users } from '~/server/db/schema'
import { verifyTotpCode } from '~/server/utils/totp'

// POST /api/auth/totp/verify (HU-ERD-83 parte 2): confirma la configuracion
// iniciada en POST /api/auth/totp/setup - la persona escanea el QR con su
// app autenticadora y manda el primer codigo de 6 digitos que le genera. Si
// es valido, recien ahi totpEnabled pasa a true (2FA queda realmente
// activo). HU multi-organizacion (2026-09-04): opera sobre `people` via
// person_id de la membresia - mismo criterio que totp/setup.post.ts.
const bodySchema = z.object({ code: z.string().min(1) })

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
  if (!person || !person.totpSecret) {
    throw createError({ statusCode: 400, statusMessage: 'Primero inicia la configuracion de 2FA (POST /api/auth/totp/setup)' })
  }
  if (person.totpEnabled) {
    throw createError({ statusCode: 409, statusMessage: 'El 2FA ya esta activo' })
  }

  const valid = await verifyTotpCode(person.totpSecret, body.code)
  if (!valid) {
    throw createError({ statusCode: 401, statusMessage: 'Codigo invalido' })
  }

  await db.update(people).set({ totpEnabled: true, updatedAt: new Date() }).where(eq(people.id, membership.personId))

  return { enabled: true }
})
