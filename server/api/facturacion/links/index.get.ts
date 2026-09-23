import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { withTenant } from '~/server/db'
import { cfdiDocumentLinks, cfdiDocuments, cfdiSeries } from '~/server/db/schema'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'

// GET /api/facturacion/links?entityId=&recordId=
// Devuelve todos los CFDI vinculados a un registro de cualquier módulo.
export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)
  const query = getQuery(event)
  const parsed = z.object({ entityId: z.string().uuid(), recordId: z.string().uuid() }).safeParse(query)
  if (!parsed.success) throw createError({ statusCode: 422, statusMessage: 'entityId y recordId son UUID válidos' })
  return withTenant(auth.tenantId, async (tx) => tx
    .select({
      link: cfdiDocumentLinks,
      documento: { id: cfdiDocuments.id, tipo: cfdiDocuments.tipo, estado: cfdiDocuments.estado, folio: cfdiDocuments.folio, uuidFiscal: cfdiDocuments.uuidFiscal, total: cfdiDocuments.total, moneda: cfdiDocuments.moneda, receptorNombre: cfdiDocuments.receptorNombre },
      serie: cfdiSeries.serie
    })
    .from(cfdiDocumentLinks)
    .innerJoin(cfdiDocuments, eq(cfdiDocuments.id, cfdiDocumentLinks.documentId))
    .innerJoin(cfdiSeries, eq(cfdiSeries.id, cfdiDocuments.serieId))
    .where(and(eq(cfdiDocumentLinks.tenantId, auth.tenantId), eq(cfdiDocumentLinks.entityId, parsed.data.entityId), eq(cfdiDocumentLinks.recordId, parsed.data.recordId)))
    .orderBy(asc(cfdiDocumentLinks.createdAt)))
})
