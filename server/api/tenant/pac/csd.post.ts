import { CsdInvalidError, PacNotConfiguredError, getPacSummary, storeCsdFiles, upsertPacSettings } from '~/server/utils/pacSettings'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'

// POST /api/tenant/pac/csd (fase B, multipart): sube el par .cer/.key del CSD
// + la contraseña de la llave privada. Multipart con campos nombrados 'cer',
// 'key' (archivos) y 'password' (texto) - patron de tenant/logo.post.ts. La
// contraseña se cifra primero (upsertPacSettings) y despues se guardan los
// binarios a disco (storeCsdFiles), que reemplaza y borra el CSD anterior.
export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)

  const parts = await readMultipartFormData(event)
  const cerPart = parts?.find((p) => p.name === 'cer' && p.filename)
  const keyPart = parts?.find((p) => p.name === 'key' && p.filename)
  const password = parts?.find((p) => p.name === 'password')?.data.toString('utf8').trim()

  if (!cerPart?.filename || !keyPart?.filename) {
    throw createError({ statusCode: 422, statusMessage: 'Selecciona el certificado (.cer) y la llave privada (.key)' })
  }
  if (!password) {
    throw createError({ statusCode: 422, statusMessage: 'La contraseña de la llave privada es requerida' })
  }

  try {
    await upsertPacSettings(auth.tenantId, auth.sub ?? null, { csdPassword: password })
    await storeCsdFiles(
      auth.tenantId,
      { fileName: cerPart.filename, buffer: cerPart.data },
      { fileName: keyPart.filename, buffer: keyPart.data }
    )
    setResponseStatus(event, 201)
    return getPacSummary(auth.tenantId)
  } catch (err) {
    if (err instanceof CsdInvalidError || err instanceof PacNotConfiguredError) {
      throw createError({ statusCode: 422, statusMessage: err.message })
    }
    throw err
  }
})
