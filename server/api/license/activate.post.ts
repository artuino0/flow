import { z } from 'zod'
import { getLicenseStatus, installLicense } from '~/server/utils/license'

const bodySchema = z.object({ license: z.string().min(1).max(32_000) })

export default defineEventHandler(async (event) => {
  const current = getLicenseStatus()
  if (!current.required) throw createError({ statusCode: 404, statusMessage: 'Este paquete no requiere activación' })
  const body = await readValidatedBody(event, bodySchema.parse)
  try {
    return installLicense(body.license)
  } catch (error) {
    throw createError({ statusCode: 422, statusMessage: error instanceof Error ? error.message : 'Licencia inválida' })
  }
})
