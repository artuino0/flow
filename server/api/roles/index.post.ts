import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { createRole, DuplicateRoleNameError, ReferenceRoleNotFoundError } from '~/server/utils/rolePermissions'

// POST /api/roles { name, copyFromRoleId? } - crea un rol nuevo. Cierra el
// hueco funcional detectado al revisar la pantalla de Roles y Permisos
// contra el diseno real en Pencil (Screen/Roles y Permisos, boton "Crear
// rol" en el Toolbar, nodo b5saUd): hasta la primera version de este
// endpoint, esta pantalla solo permitia listar roles existentes y editar su
// matriz de permisos, sin forma alguna de dar de alta un rol nuevo.
//
// copyFromRoleId (2026-09-01, "checa esto" sobre Screen/Roles y Permisos -
// Nuevo Rol, un segundo mock separado del listado que no se habia revisado
// todavia): opcional - copia de entrada los permisos de un rol ya existente
// del mismo tenant como punto de partida, en vez de arrancar siempre en
// blanco. Mismo guard que el resto de la gestion de roles (requireAdminRole).
const bodySchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(100, 'El nombre no puede superar los 100 caracteres'),
  copyFromRoleId: z.string().uuid().nullable().optional()
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  try {
    const role = await createRole(auth.tenantId, body.name, body.copyFromRoleId ?? null)
    setResponseStatus(event, 201)
    return { role }
  } catch (err) {
    if (err instanceof DuplicateRoleNameError) {
      throw createError({ statusCode: 409, statusMessage: err.message })
    }
    if (err instanceof ReferenceRoleNotFoundError) {
      throw createError({ statusCode: 404, statusMessage: err.message })
    }
    throw err
  }
})
