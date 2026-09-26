import { getPacProvider } from '~/server/utils/pac/provider'
import { stampDocument } from '~/server/utils/cfdi/timbrado'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'
import { failCfdi } from '~/server/utils/cfdiHttp'
import { assertStampCapacity, consumeStampPackage } from '~/server/utils/billing'

// POST /api/facturacion/documents/:id/timbrar — corazón de la fase D.
// Idempotente a nivel de estado: si ya está timbrado devuelve 409; si hay un
// intento anterior, primero verifica con el PAC (getStatus/findBySerieFolio)
// y adopta el timbrado si existe, antes de consumir otro folio (reglas 4-5 de
// cfdi/timbrado.ts — la defensa anti doble timbrado).
export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id del documento' })
  try {
    await assertStampCapacity(auth.tenantId)
    const provider = await getPacProvider(auth.tenantId)
    const result = await stampDocument(auth.tenantId, id, auth.sub ?? null, provider)
    await consumeStampPackage(auth.tenantId)
    return result
  } catch (err) {
    failCfdi(err)
  }
})
