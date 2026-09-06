import { requirePermission } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { loadTenantFieldContext, buildFieldTree } from '~/server/utils/reportFieldPath'

// GET /api/print-reports/fields?entity=<slug> (HU-ERD-88) - "Campos
// disponibles" del panel izquierdo del Diseñador de 3 columnas: el árbol
// completo de campos propios + relaciones forward (1:1) e inversas (1:N)
// navegables desde `entity`, ya resuelto por buildFieldTree()/reportFieldPath.ts
// (mismo motor que usa executePrintReport() para validar las rutas que arma
// este árbol - un camino que el frontend ofrece siempre es un camino que el
// backend sabe resolver).
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const entitySlug = typeof query.entity === 'string' ? query.entity : undefined
  if (!entitySlug) {
    throw createError({ statusCode: 400, statusMessage: 'Falta el parámetro "entity"' })
  }
  const { auth, entity } = await requirePermission(event, entitySlug, 'canRead')

  return withTenant(auth.tenantId, async (tx) => {
    const ctx = await loadTenantFieldContext(tx, auth.tenantId)
    return { fields: buildFieldTree(ctx, entity.id) }
  })
})
