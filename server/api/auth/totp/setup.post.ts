import { eq } from 'drizzle-orm'
import { requireAuth } from '~/server/utils/rbac'
import { db, withTenant } from '~/server/db'
import { people, users } from '~/server/db/schema'
import { generateTotpSecret, totpKeyUri, totpQrCodeDataUrl } from '~/server/utils/totp'

// POST /api/auth/totp/setup (HU-ERD-83 parte 2): arranca la configuracion de
// 2FA para la persona autenticada - genera un secreto nuevo y lo guarda en
// people.totpSecret, pero NO activa 2FA todavia (totpEnabled sigue en false
// hasta POST /api/auth/totp/verify con un codigo real de la app
// autenticadora - ver el comentario largo en server/db/schema.ts sobre por
// que). Devuelve el secreto (para carga manual) + la URI otpauth:// + un QR
// ya renderizado como data: URL, para que "Mi cuenta" solo tenga que
// mostrarlos, sin repetir la logica de otplib/qrcode en el frontend.
//
// HU multi-organizacion (2026-09-04): el 2FA es de la PERSONA (ver el
// comentario largo en server/db/schema.ts) - auth.sub sigue siendo la
// membresia (tenant-scoped, RLS real), se resuelve su person_id primero y
// recien con eso se lee/escribe `people` (global). Activarlo protege TODAS
// las organizaciones de la persona a la vez, no solo la actual.
export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)

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
  if (person.totpEnabled) {
    throw createError({ statusCode: 409, statusMessage: 'El 2FA ya esta activo - desactivalo antes de reconfigurarlo' })
  }

  const secret = generateTotpSecret()
  await db.update(people).set({ totpSecret: secret, updatedAt: new Date() }).where(eq(people.id, membership.personId))

  const otpauthUrl = totpKeyUri(secret, person.email)
  const qrCodeDataUrl = await totpQrCodeDataUrl(otpauthUrl)

  return { secret, otpauthUrl, qrCodeDataUrl }
})
