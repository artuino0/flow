import { getPacSummary, type PacSummary } from '~/server/utils/pacSettings'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'

// GET /api/tenant/pac (fase B de DOCS/HU_Timbrado_CFDI_PAC.md): resumen de la
// configuracion del PAC para la seccion Facturacion de Ajustes. Solo flags y
// metadatos (hasApiKey/hasCsd, nombres de archivo, vigencia, ultima prueba) -
// NUNCA secretos (patron hasLogo de ERD-62). Sin fila aun => defaults de
// "no configurado", para que la UI pueda renderizar el formulario vacio.
export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)
  const summary = await getPacSummary(auth.tenantId)
  return (
    summary ?? {
      provider: 'facturapi',
      sandbox: true,
      hasApiKey: false,
      hasCsd: false,
      csdCerFileName: null,
      csdKeyFileName: null,
      csdValidUntil: null,
      lastTestAt: null,
      lastTestOk: null
    } satisfies PacSummary
  )
})
