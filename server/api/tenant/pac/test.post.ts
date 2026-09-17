import { PacNotConfiguredError, recordPacTest } from '~/server/utils/pacSettings'
import { getPacProvider } from '~/server/utils/pac/provider'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'

// POST /api/tenant/pac/test (fase B): prueba de conexion contra el PAC -
// credenciales rechazadas devuelven { ok: false, message } con HTTP 200 (el
// resultado ES la respuesta del endpoint, no un fallo del servidor); solo la
// falta de configuracion corta con 422. Queda registro en lastTestAt/lastTestOk
// para la UI. El mensaje viene del provider y por construccion no contiene la
// API key (ver describeError en pac/facturapi.ts).
export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)

  let provider
  try {
    provider = await getPacProvider(auth.tenantId)
  } catch (err) {
    if (err instanceof PacNotConfiguredError) {
      throw createError({ statusCode: 422, statusMessage: 'Guarda la API key del PAC antes de probar la conexión' })
    }
    throw err
  }

  const result = await provider.verifyCredentials()
  await recordPacTest(auth.tenantId, result.ok)
  return result
})
