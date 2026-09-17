import { deleteCsdFiles, getPacSummary } from '~/server/utils/pacSettings'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'

// DELETE /api/tenant/pac/csd (fase B): borra el CSD del tenant (archivos en
// disco + columnas). Idempotente como tenant/logo.delete.ts - no falla si no
// habia certificado. La contraseña cifrada se conserva (inofensiva sin .key y
// evita pedirla de nuevo si el admin re-sube el mismo certificado).
export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)
  await deleteCsdFiles(auth.tenantId)
  return getPacSummary(auth.tenantId)
})
