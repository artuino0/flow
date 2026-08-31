import { requireAdminRole } from '~/server/utils/rbac'
import { listEntities } from '~/server/utils/moduleEntities'

// GET /api/entities (HU-ERD-69)
// Lista todos los modulos (entities) del tenant, para la pantalla de
// administracion pages/modulos/index.vue. Solo Administrador (requireAdminRole,
// HU-ERD-61) - mismo guard que POST/PUT/DELETE (HU-ERD-66): esta pantalla es
// de gestion de metadatos, no de lectura de datos (eso ya lo cubre
// GET /api/records/:entity con RBAC por entidad, HU-ERD-15/16).
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const entities = await listEntities(auth.tenantId)
  return { entities }
})
