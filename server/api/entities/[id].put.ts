import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { updateEntity } from '~/server/utils/moduleEntities'
import { detailLayoutSchema } from '~/server/utils/detailLayout'
import { listLayoutSchema } from '~/server/utils/listLayout'
import { MODULE_ICON_KEY_SET } from '~/server/utils/moduleIcons'

// PUT /api/entities/:id { name?, description?, isActive?, icon?, detailLayout?, listLayout? }
// (HU-ERD-66, detailLayout HU-ERD-74, listLayout HU-ERD-75, isActive:
// rediseno "Editar Módulo"; icon: pedido directo del usuario 2026-09-01 - ver
// comentarios largos en server/db/schema.ts) - edita nombre/descripcion de un
// modulo existente. El slug NO se puede cambiar aca a proposito - ya se usa
// en URLs (/registros/:slug) y en el endpoint de campos
// (GET /api/entities/:slug/fields, HU-ERD-23); renombrarlo queda fuera de
// alcance de esta HU.
const bodySchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').optional(),
  description: z.string().trim().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
  // Null explicito vuelve al icono generico "blocks" (moduleIconComponent(),
  // utils/moduleIcons.ts); undefined (omitido) no lo toca - mismo criterio
  // que detailLayout/listLayout de abajo. z.string().refine() en vez de
  // z.enum(): ver mismo comentario en server/api/entities/index.post.ts.
  icon: z
    .string()
    .refine((v) => MODULE_ICON_KEY_SET.has(v), { message: 'Icono invalido' })
    .nullable()
    .optional(),
  // HU-ERD-74/75: null explicito borra el layout guardado (vuelve al orden
  // por defecto, ver resolveDetailLayout()/resolveListLayout()); undefined
  // (omitido) no lo toca.
  detailLayout: detailLayoutSchema.nullable().optional(),
  listLayout: listLayoutSchema.nullable().optional()
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)

  const entity = await updateEntity(auth.tenantId, id, body)
  if (!entity) {
    throw createError({ statusCode: 404, statusMessage: 'Modulo no encontrado' })
  }
  return entity
})
