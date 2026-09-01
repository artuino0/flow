import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { createRole, DuplicateRoleNameError } from '~/server/utils/rolePermissions'

// POST /api/roles { name } - crea un rol nuevo, sin permisos iniciales sobre
// ninguna entidad (el administrador los habilita despues desde la Permission
// Matrix). Cierra el hueco funcional detectado al revisar la pantalla de
// Roles y Permisos contra el diseno real en Pencil (Screen/Roles y Permisos,
// boton "Crear rol" en el Toolbar, nodo b5saUd): hasta ahora esta pantalla
// solo permitia listar roles existentes y editar su matriz de permisos, sin
// forma alguna (ni en el frontend ni en el backend) de dar de alta un rol
// nuevo. Mismo guard que el resto de la gestion de roles (requireAdminRole).
const bodySchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(100, 'El nombre no puede superar los 100 caracteres')
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  try {
    const role = await createRole(auth.tenantId, body.name)
    setResponseStatus(event, 201)
    return { role }
  } catch (err) {
    if (err instanceof DuplicateRoleNameError) {
      throw createError({ statusCode: 409, statusMessage: err.message })
    }
    throw err
  }
})
