import { z } from 'zod'
import { requirePermission } from '~/server/utils/rbac'
import { importRecords, TooManyImportRowsError } from '~/server/utils/csvImport'

// HU-ERD-80: importacion masiva de datos (CSV) por entidad. Requiere el mismo
// permiso que crear un record uno por uno (canCreate) - importar N filas es,
// en esencia, N creaciones. Ver server/utils/csvImport.ts para las reglas
// completas (resolucion de columnas relation por texto, validacion con el
// schema Zod dinamico, semantica de import parcial).
const bodySchema = z.object({
  rows: z.array(z.record(z.string())).min(1, 'El CSV no tiene filas para importar')
})

export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canCreate')
  const body = await readValidatedBody(event, bodySchema.parse)

  try {
    const result = await importRecords(auth.tenantId, entity.id, body.rows)
    return result
  } catch (err) {
    if (err instanceof TooManyImportRowsError) {
      throw createError({ statusCode: 422, statusMessage: err.message })
    }
    throw err
  }
})
