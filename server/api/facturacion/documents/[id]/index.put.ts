import { documentoUpdateSchema, updateDocument } from '~/server/utils/cfdiDocuments'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'
import { failCfdi, zodIssueMessage } from '~/server/utils/cfdiHttp'

// PUT /api/facturacion/documents/:id — edición de borradores (y de documentos
// en error que aún no tienen UUID). Un documento timbrado/cancelado es
// inmutable: 409 (inmutabilidad fiscal, ver updateDocument).
export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id del documento' })
  const body = await readBody(event)
  const parsed = documentoUpdateSchema.safeParse(body)
  if (!parsed.success) throw createError({ statusCode: 422, statusMessage: zodIssueMessage(parsed.error) })
  try {
    return await updateDocument(auth.tenantId, auth.sub ?? null, id, parsed.data)
  } catch (err) {
    failCfdi(err)
  }
})
