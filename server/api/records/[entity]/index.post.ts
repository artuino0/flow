import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { getEntityZodSchema } from '~/server/utils/dynamicSchema'
import { withTenant } from '~/server/db'
import { entityFields, records, recordActivities } from '~/server/db/schema'
import { fireTriggersForRecord } from '~/server/utils/triggers'
import { generateIncrementalValue, MissingIncrementalPrefixError } from '~/server/utils/incrementalField'

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

  let row
  try {
    row = await withTenant(auth.tenantId, async (tx) => {
      // Pedido directo del usuario (2026-09-04): campos 'incremental' se
      // generan aca, DENTRO de esta misma transaccion (ver el porque en
      // server/utils/incrementalField.ts) - nunca llegan en el body (buildFieldType()
      // los marca .optional().nullable() sin importar isRequired, dynamicSchema.ts),
      // asi que si el usuario mando algo para esa clave, parsed.data ya lo tiene
      // como vino (passthrough) pero se pisa aca de todas formas: el valor real
      // SIEMPRE es el generado, nunca el que haya llegado en el body.
      const allFields = await tx
        .select({ id: entityFields.id, name: entityFields.name, dataType: entityFields.dataType, validationRules: entityFields.validationRules })
        .from(entityFields)
        .where(eq(entityFields.entityId, entity.id))

      const customData = { ...parsed.data } as Record<string, unknown>
      for (const field of allFields) {
        if (field.dataType !== 'incremental') continue
        customData[field.name] = await generateIncrementalValue(tx, auth.tenantId, field, customData)
      }

      const [r] = await tx.insert(records).values({ entityId: entity.id, tenantId: auth.tenantId, customData }).returning()
      
      await tx.insert(recordActivities).values({
        tenantId: auth.tenantId,
        recordId: r.id,
        userId: auth.sub,
        actionType: 'CREATED',
        details: { customData }
      })
      
      return r
    })
  } catch (err) {
    if (err instanceof MissingIncrementalPrefixError) {
      throw createError({ statusCode: 422, statusMessage: err.message })
    }
    throw err
  }

  // HU-ERD-48: sin `await` a proposito - se dispara DESPUES de que el insert
  // ya se confirmo arriba, nunca agrega latencia ni puede convertirse en un
  // error de esta respuesta (fireTriggersForRecord atrapa sus propios errores).
  fireTriggersForRecord(auth.tenantId, entity.id, 'on_create', row.id, row.customData as Record<string, unknown>)

  setResponseStatus(event, 201)
  return row
})
