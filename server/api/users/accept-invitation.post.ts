import { z } from 'zod'
import { passwordPolicySchema } from '~/server/utils/passwordPolicy'
import { InvalidInvitationTokenError, InvitationExpiredError, acceptInvitation } from '~/server/utils/users'

// POST /api/users/accept-invitation { token, password, fullName? } - PUBLICO
// (ver server/middleware/auth.ts): el invitado todavia no tiene sesion.
// pages/invitacion/[token].vue (fiel al enlace real del correo,
// app.erpdinamico.com/invitacion/<token> en el .pen). La contraseña se valida
// contra el mismo passwordPolicySchema que cualquier otro cambio de
// contraseña (HU-ERD-83).
const bodySchema = z.object({
  token: z.string().min(1),
  password: passwordPolicySchema,
  fullName: z.string().trim().min(1).max(200).optional()
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, bodySchema.parse)

  try {
    await acceptInvitation(body.token, body.password, body.fullName)
    return { ok: true }
  } catch (err) {
    if (err instanceof InvalidInvitationTokenError) {
      throw createError({ statusCode: 404, statusMessage: err.message })
    }
    if (err instanceof InvitationExpiredError) {
      throw createError({ statusCode: 410, statusMessage: err.message })
    }
    throw err
  }
})
