import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { requireAuth } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { users } from '~/server/db/schema'
import { verifyTotpCode } from '~/server/utils/totp'

// POST /api/auth/totp/verify (HU-ERD-83 parte 2): confirma la configuracion
// iniciada en POST /api/auth/totp/setup - el usuario escanea el QR con su
// app autenticadora y manda el primer codigo de 6 digitos que le genera. Si
// es valido, recien ahi totpEnabled pasa a true (2FA queda realmente
// activo).
const bodySchema = z.object({ code: z.string().min(1) })

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  const user = await withTenant(auth.tenantId, async (tx) => {
    const [row] = await tx.select().from(users).where(and(eq(users.id, auth.sub), eq(users.tenantId, auth.tenantId))).limit(1)
    return row ?? null
  })
  if (!user || !user.totpSecret) {
    throw createError({ statusCode: 400, statusMessage: 'Primero inicia la configuracion de 2FA (POST /api/auth/totp/setup)' })
  }
  if (user.totpEnabled) {
    throw createError({ statusCode: 409, statusMessage: 'El 2FA ya esta activo' })
  }

  const valid = await verifyTotpCode(user.totpSecret, body.code)
  if (!valid) {
    throw createError({ statusCode: 401, statusMessage: 'Codigo invalido' })
  }

  await withTenant(auth.tenantId, async (tx) => {
    await tx.update(users).set({ totpEnabled: true, updatedAt: new Date() }).where(and(eq(users.id, auth.sub), eq(users.tenantId, auth.tenantId)))
  })

  return { enabled: true }
})
