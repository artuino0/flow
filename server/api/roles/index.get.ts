import { requireAdminRole } from '~/server/utils/rbac'
import { listRoles } from '~/server/utils/rolePermissions'

// GET /api/roles (HU-ERD-33): listado de roles del tenant, para la pantalla
// de gestion de roles y permisos. Mismo guard que la configuracion general
// del tenant (requireAdminRole, HU-ERD-61) - gestionar RBAC es una accion de
// administrador, no algo que cualquier rol pueda ver.
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const roles = await listRoles(auth.tenantId)
  return { roles }
})
