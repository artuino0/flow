import { z } from 'zod'
import { requireAuth, requirePermission } from '~/server/utils/rbac'
import { printReportDslSchema } from '~/server/utils/printReport'
import { getPrintReport, updatePrintReport, PrintReportNotFoundError } from '~/server/utils/printReports'

// PUT /api/print-reports/:id { title, dsl } (HU-ERD-88) - "Guardar cambios"
// al reabrir una plantilla existente en el Diseñador. Se valida el permiso
// dos veces si dsl.baseEntity cambió (caso raro, pero posible: el usuario
// podría, en teoría, reapuntar el reporte a otra entidad base) - sobre la
// entidad ACTUAL del registro (antes de tocar nada) y sobre la NUEVA
// (después), para no permitir "mover" un reporte hacia una entidad donde el
// usuario no tiene permiso de lectura.
const bodySchema = z.object({
  title: z.string().trim().min(1).max(120),
  dsl: printReportDslSchema
})

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const id = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)

  try {
    const existing = await getPrintReport(auth.tenantId, id)
    await requirePermission(event, existing.baseEntitySlug, 'canRead')
    if (body.dsl.baseEntity !== existing.baseEntitySlug) {
      await requirePermission(event, body.dsl.baseEntity, 'canRead')
    }
    return await updatePrintReport(auth.tenantId, id, body)
  } catch (err) {
    if (err instanceof PrintReportNotFoundError) {
      throw createError({ statusCode: 404, statusMessage: err.message })
    }
    throw err
  }
})
