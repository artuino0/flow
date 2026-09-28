import { z } from 'zod'
import { confirmEmailVerification } from '~/server/utils/emailVerification'

const bodySchema = z.object({ token: z.string().min(20).max(200) })

export default defineEventHandler(async event => {
  const { token } = await readValidatedBody(event, bodySchema.parse)
  if (!(await confirmEmailVerification(token))) throw createError({ statusCode: 422, statusMessage: 'El enlace expiró o ya fue utilizado' })
  return { ok: true }
})
