import { z } from 'zod'
import { requireAuth } from '~/server/utils/rbac'
import { confirmVerificationCode, registrationPerson } from '~/server/utils/emailVerification'
import { authRequestLimit } from '~/server/utils/authPersistentLimit'
export default defineEventHandler(async event => {
  const auth = requireAuth(event)
  const person = await registrationPerson(auth.tenantId, auth.sub)
  await authRequestLimit(event, 'otp', person.id, auth.tenantId)
  const { code } = await readValidatedBody(event, z.object({ code: z.string().regex(/^\d{6}$/) }).parse)
  if (!(await confirmVerificationCode(person.id, auth.tenantId, code))) throw createError({ statusCode: 422, statusMessage: 'El código no es válido o ya venció. Revisa el último correo o solicita otro código.' })
  return { ok: true }
})
