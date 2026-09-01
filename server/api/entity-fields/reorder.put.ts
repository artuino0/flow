import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { reorderEntityFields, EntityNotFoundError, InvalidFieldOrderError } from '~/server/utils/moduleEntityFields'

// PUT /api/entity-fields/reorder { entityId, order: fieldId[] }
// "El organizador" - pedido del usuario (2026-09-01) tras ver la lista de
// campos de un modulo sin forma de reordenarlos.
//
// Recurso plano y ESTATICO ("reorder" no es un uuid), sibling de
// /api/entity-fields/:fieldId - misma profundidad de 1 segmento bajo el
// mismo prefijo, a diferencia del bug de enrutamiento de Nitro/rou3 ya
// documentado en server/utils/moduleEntityFields.ts (ese caso mezclaba DOS
// PROFUNDIDADES distintas bajo el mismo prefijo: .../fields, que termina ahi,
// con .../fields/:fieldId, que continua). Aca "reorder" y ":fieldId" estan al
// mismo nivel - Nitro resuelve la ruta estatica antes que la dinamica, patron
// de enrutamiento estandar sin ese riesgo.
//
// Body = la lista COMPLETA de fieldIds de la entidad en el orden deseado
// (posicion en el array = nuevo sortOrder) - mas simple que un endpoint por
// swap individual, y evita dejar sortOrder en un estado a medio mover si el
// usuario hace varios clicks de "mover" rapido (reorderEntityFields valida
// que sea exactamente el conjunto actual antes de escribir nada).
const bodySchema = z.object({
  entityId: z.string().uuid(),
  order: z.array(z.string().uuid()).min(1)
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  try {
    const fields = await reorderEntityFields(auth.tenantId, body.entityId, body.order)
    return { fields }
  } catch (err) {
    if (err instanceof EntityNotFoundError) {
      throw createError({ statusCode: 404, statusMessage: 'Modulo no encontrado' })
    }
    if (err instanceof InvalidFieldOrderError) {
      throw createError({ statusCode: 422, statusMessage: err.message })
    }
    throw err
  }
})
