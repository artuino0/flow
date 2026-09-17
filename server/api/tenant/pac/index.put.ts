import { z } from 'zod'
import { getPacSummary, upsertPacSettings } from '~/server/utils/pacSettings'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'

// PUT /api/tenant/pac (fase B): guarda proveedor / API key / modo sandbox /
// contraseña del CSD, cifrando secretos con settingsCrypto. apiKey y
// csdPassword son WRITE-ONLY: si no vienen en el body se conserva el valor
// guardado (mismo contrato que password en settings/email.put.ts - el input
// type=password de la UI jamas devuelve el secreto). Provider 'lab' =
// laboratorio local sin PAC externo (solo sandbox; no pide apiKey/CSD).
const bodySchema = z.object({
  provider: z.enum(['facturapi', 'lab']).optional(),
  apiKey: z.string().trim().min(1).max(200).optional(),
  sandbox: z.boolean().optional(),
  csdPassword: z.string().min(1).max(100).optional()
})

export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  if (body.provider === undefined && body.apiKey === undefined && body.sandbox === undefined && body.csdPassword === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'No hay cambios que guardar' })
  }
  await upsertPacSettings(auth.tenantId, auth.sub ?? null, body)
  return getPacSummary(auth.tenantId)
})
