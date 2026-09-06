import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { isFeatureEnabled } from '~/server/utils/appConfig'
import { previewReport } from '~/server/utils/reports'
import { AiProviderNotConfiguredError, AiResponseInvalidError } from '~/server/utils/reportQuery'

// POST /api/reports/preview { description } (Épica ERD-46, "Generar
// previsualización" de Screen/Reportes - Nuevo reporte) - NO persiste nada
// (ver comentario largo en server/utils/reports.ts): genera el DSL con IA,
// lo ejecuta contra el esquema OLAP del tenant, y devuelve queryDsl +
// resultado para que el frontend los muestre y, recién si el usuario
// confirma, los mande tal cual a POST /api/reports.
//
// Guard: requireAdminRole, mismo criterio que Módulos/Triggers/Roles - es
// configuración/administración de la plataforma, no una pantalla de uso
// diario de cualquier rol.
const bodySchema = z.object({
  description: z.string().trim().min(1, 'Describí el reporte que querés generar').max(2000)
})

export default defineEventHandler(async (event) => {
  if (!isFeatureEnabled('reports')) {
    throw createError({ statusCode: 404, statusMessage: 'Funcionalidad deshabilitada' })
  }

  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  try {
    return await previewReport(auth.tenantId, body.description)
  } catch (err) {
    if (err instanceof AiProviderNotConfiguredError) {
      throw createError({ statusCode: 500, statusMessage: err.message })
    }
    if (err instanceof AiResponseInvalidError) {
      throw createError({ statusCode: 422, statusMessage: 'No se pudo generar el reporte a partir de esa descripción. Probá simplificarla o usar otros términos.' })
    }
    throw err
  }
})
