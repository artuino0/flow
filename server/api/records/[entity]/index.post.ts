import { z } from 'zod'
import { requirePermission } from '~/server/utils/rbac'
import { getEntityZodSchema } from '~/server/utils/dynamicSchema'
import { withTenant } from '~/server/db'
import { records } from '~/server/db/schema'
import { fireTriggersForRecord } from '~/server/utils/triggers'

// POST /api/records/:entity { customData } (HU-ERD-16)
// customData se valida en dos pasos: forma basica de objeto aca, y despues
// contra el schema Zod dinamico generado desde entity_fields (HU-ERD-17).
const bodySchema = z.object({
  customData: z.record(z.any()).default({})
})

export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canCreate')
  const body = await readValidatedBody(event, bodySchema.parse)

  const dynamicSchema = await getEntityZodSchema(auth.tenantId, entity.id)
  const parsed = dynamicSchema.safeParse(body.customData)
  if (!parsed.success) {
    throw createError({
      statusCode: 422,
      statusMessage: 'customData invalido para esta entidad',
      data: parsed.error.flatten()
    })
  }

  const row = await withTenant(auth.tenantId, async (tx) => {
    const [r] = await tx
      .insert(records)
      .values({ entityId: entity.id, tenantId: auth.tenantId, customData: parsed.data })
      .returning()
    return r
  })

  // HU-ERD-48: sin `await` a proposito - se dispara DESPUES de que el insert
  // ya se confirmo arriba, nunca agrega latencia ni puede convertirse en un
  // error de esta respuesta (fireTriggersForRecord atrapa sus propios errores).
  fireTriggersForRecord(auth.tenantId, entity.id, 'on_create', row.customData as Record<string, unknown>)

  setResponseStatus(event, 201)
  return row
})
