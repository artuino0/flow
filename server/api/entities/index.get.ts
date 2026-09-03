import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { listEntities, MODULE_KINDS } from '~/server/utils/moduleEntities'

// GET /api/entities?moduleKind= (HU-ERD-69; moduleKind: ERD-86)
// Lista todos los modulos (entities) del tenant, para la pantalla de
// administracion pages/modulos/index.vue. Solo Administrador (requireAdminRole,
// HU-ERD-61) - mismo guard que POST/PUT/DELETE (HU-ERD-66): esta pantalla es
// de gestion de metadatos, no de lectura de datos (eso ya lo cubre
// GET /api/records/:entity con RBAC por entidad, HU-ERD-15/16).
//
// ERD-86: moduleKind opcional filtra a 'hecho' (pages/modulos/index.vue) o
// 'dimension' (pages/catalogos/index.vue) - mismo endpoint para ambas
// pantallas, sin duplicar logica de listado.
const querySchema = z.object({
  moduleKind: z.enum(MODULE_KINDS).optional()
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const query = await getValidatedQuery(event, querySchema.parse)
  const entities = await listEntities(auth.tenantId, query.moduleKind)
  return { entities }
})
