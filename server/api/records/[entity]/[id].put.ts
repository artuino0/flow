import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { getEntityZodSchema } from '~/server/utils/dynamicSchema'
import { withTenant } from '~/server/db'
import { records } from '~/server/db/schema'

// PUT /api/records/:entity/:id { customData } (HU-ERD-16)
// Igual que en el create, customData se revalida contra el schema Zod
// dinamico de la entidad (HU-ERD-17) antes de actualizar.
const bodySchema = z.object({
  customData: z.record(z.any())
})

export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const id = getRouterParam(event, 'id')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canUpdate')
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
      .update(records)
      // customData ya se valido arriba contra el schema vigente (ERD-17), asi
      // que esta edicion deja al registro limpio (HU-ERD-18: la edicion es
      // uno de los dos puntos de revalidacion perezosa, junto con el GET).
      .set({ customData: parsed.data, isDirty: false, updatedAt: new Date() })
      .where(and(eq(records.id, id), eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id)))
      .returning()
    return r
  })

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Registro no encontrado' })
  }
  return row
})
