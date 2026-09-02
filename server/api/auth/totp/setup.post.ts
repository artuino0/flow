import { eq, and } from 'drizzle-orm'
import { requireAuth } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { users } from '~/server/db/schema'
import { generateTotpSecret, totpKeyUri, totpQrCodeDataUrl } from '~/server/utils/totp'

// POST /api/auth/totp/setup (HU-ERD-83 parte 2): arranca la configuracion de
// 2FA para el usuario autenticado - genera un secreto nuevo y lo guarda en
// users.totpSecret, pero NO activa 2FA todavia (totpEnabled sigue en false
// hasta POST /api/auth/totp/verify con un codigo real de la app
// autenticadora - ver el comentario largo en server/db/schema.ts sobre por
// que). Devuelve el secreto (para carga manual) + la URI otpauth:// + un QR
// ya renderizado como data: URL, para que "Mi cuenta" solo tenga que
// mostrarlos, sin repetir la logica de otplib/qrcode en el frontend.
export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)

  const user = await withTenant(auth.tenantId, async (tx) => {
    const [row] = await tx.select().from(users).where(and(eq(users.id, auth.sub), eq(users.tenantId, auth.tenantId))).limit(1)
    return row ?? null
  })
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: 'Usuario no encontrado' })
  }
  if (user.totpEnabled) {
    throw createError({ statusCode: 409, statusMessage: 'El 2FA ya esta activo - desactivalo antes de reconfigurarlo' })
  }

  const secret = generateTotpSecret()
  await withTenant(auth.tenantId, async (tx) => {
    await tx.update(users).set({ totpSecret: secret, updatedAt: new Date() }).where(and(eq(users.id, auth.sub), eq(users.tenantId, auth.tenantId)))
  })

  const otpauthUrl = totpKeyUri(secret, user.email)
  const qrCodeDataUrl = await totpQrCodeDataUrl(otpauthUrl)

  return { secret, otpauthUrl, qrCodeDataUrl }
})
