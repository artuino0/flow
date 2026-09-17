import { z } from 'zod'
import { issueSessionCookies, verifyPendingOrgToken } from '~/server/utils/auth'
import { findActiveMembership } from '~/server/utils/peopleAuth'

// POST /api/auth/login/select-org (HU multi-organizacion, 2026-09-04):
// tercer paso del login SOLO cuando la persona pertenece a mas de una
// organización (POST /api/auth/login o /login/totp devolvieron
// requiresOrgSelection:true + pendingToken + la lista de organizaciones).
// Publico (no pasa por el middleware de auth.ts - no hay sesion previa,
// mismo criterio que login/totp.post.ts) - recibe el pendingToken (5 min,
// nunca cookie) + el tenantId elegido, y si la persona realmente tiene una
// membresia ACTIVA ahi (nunca confia ciegamente en lo que el cliente mande -
// podria haber elegido un tenantId que no le pertenece), recien ahi emite la
// sesion real. No vuelve a pedir contraseña ni codigo TOTP - ya se
// validaron en el paso anterior, este token es la prueba de eso.
const bodySchema = z.object({
  pendingToken: z.string().min(1),
  tenantId: z.string().uuid()
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, bodySchema.parse)
  const config = useRuntimeConfig()

  let pending: { sub: string }
  try {
    pending = verifyPendingOrgToken(body.pendingToken, config.jwtSecret as string)
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Token invalido o expirado, volve a iniciar sesion' })
  }

  const membership = await findActiveMembership(pending.sub, body.tenantId)
  if (!membership) {
    throw createError({ statusCode: 401, statusMessage: 'No tenes acceso a esa organización' })
  }

  await issueSessionCookies(event, { sub: membership.userId, tenantId: body.tenantId, roleId: membership.roleId }, config.jwtSecret as string)

  return { ok: true }
})
