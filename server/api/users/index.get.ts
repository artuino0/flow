import { requireAdminRole } from '~/server/utils/rbac'
import { listUsers } from '~/server/utils/users'

// GET /api/users (HU-ERD-84): listado de usuarios del tenant, para
// Screen/Usuarios (columnas Usuario/Rol/Estado/Acciones). Mismo guard que
// roles y configuracion general - gestionar accesos es una accion de
// administrador.
export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const users = await listUsers(auth.tenantId)
  return { users }
})
