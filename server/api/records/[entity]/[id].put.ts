import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { requirePermission } from '~/server/utils/rbac'
import { getEntityZodSchema } from '~/server/utils/dynamicSchema'
import { withTenant } from '~/server/db'
import { entityFields, records } from '~/server/db/schema'
import { fireTriggersForRecord } from '~/server/utils/triggers'
import { recordNotDeleted } from '~/server/utils/records'

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
    // Pedido directo del usuario (2026-09-04): un campo 'incremental' es
    // "100% automatico y de solo lectura, nunca editable a mano" - esta edicion
    // REEMPLAZA customData entero (a diferencia del create, aca no hay nada que
    // generar), asi que si no se preserva explicitamente el valor ya guardado,
    // el nuevo customData (que nunca trae la clave - buildFieldType() la marca
    // .optional().nullable() sin importar isRequired) lo dejaria vacio/perdido.
    // Se lee el registro actual PRIMERO (misma tx) para copiar esos valores tal
    // cual, sin importar lo que haya llegado en el body.
    // ERD-87: no se puede editar un registro eliminado (papelera) - se
    // responde 404, igual que un id inexistente.
    const [current] = await tx
      .select({ customData: records.customData })
      .from(records)
      .where(and(eq(records.id, id), eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id), recordNotDeleted))
      .limit(1)
    if (!current) return undefined

    const incrementalFieldNames = (
      await tx.select({ name: entityFields.name }).from(entityFields).where(and(eq(entityFields.entityId, entity.id), eq(entityFields.dataType, 'incremental')))
    ).map((f) => f.name)

    const customData = { ...parsed.data } as Record<string, unknown>
    const currentCustomData = current.customData as Record<string, unknown>
    for (const name of incrementalFieldNames) customData[name] = currentCustomData[name]

    const [r] = await tx
      .update(records)
      // customData ya se valido arriba contra el schema vigente (ERD-17), asi
      // que esta edicion deja al registro limpio (HU-ERD-18: la edicion es
      // uno de los dos puntos de revalidacion perezosa, junto con el GET).
      .set({ customData, isDirty: false, updatedAt: new Date() })
      .where(and(eq(records.id, id), eq(records.tenantId, auth.tenantId), eq(records.entityId, entity.id), recordNotDeleted))
      .returning()
    return r
  })

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Registro no encontrado' })
  }

  // HU-ERD-48: mismo criterio "fire-and-forget" que el create - ver comentario
  // largo en index.post.ts.
  fireTriggersForRecord(auth.tenantId, entity.id, 'on_update', row.id, row.customData as Record<string, unknown>)

  return row
})
