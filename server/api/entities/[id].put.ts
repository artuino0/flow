import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { requireAdminRole } from '~/server/utils/rbac'
import { updateEntity } from '~/server/utils/moduleEntities'
import { detailLayoutSchema } from '~/server/utils/detailLayout'
import { listLayoutSchema } from '~/server/utils/listLayout'
import { MODULE_ICON_KEY_SET } from '~/server/utils/moduleIcons'
import { withTenant } from '~/server/db'
import { entityFields } from '~/server/db/schema'
import { labelConfigSchema } from '~/utils/labelTemplates'
import { boardConfigSchema } from '~/server/utils/boardConfig'
import { validateWorkflowConfig, StateWorkflowError } from '~/server/utils/stateWorkflow'

// PUT /api/entities/:id { name?, description?, isActive?, icon?, detailLayout?, listLayout?, labelField?, singularName? }
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
  listLayout: listLayoutSchema.nullable().optional(),
  boardConfig: boardConfigSchema.nullable().optional(),
  workflowConfig: z.unknown().nullable().optional(),
  // Reportado por el usuario (2026-09-03, ver comentario largo en
  // server/db/schema.ts): "Campo a mostrar" del picker de relaciones
  // (ModuleListLayoutCard.vue) - null explicito vuelve a la heuristica
  // automatica; undefined (omitido) no lo toca. Se valida contra los campos
  // REALES de esta entidad mas abajo (no alcanza con z.string(): tiene que
  // ser un name de entity_fields propio, de tipo texto, nunca "id" - el
  // sintetico de fields.get.ts).
  labelField: z.string().trim().min(1).nullable().optional(),
  // Pedido directo del usuario (2026-09-05) - ver comentario largo en
  // server/db/schema.ts (entities.singularName). Null explicito vuelve a
  // usar `name` tal cual en "Nuevo X"/"Editar X"; undefined (omitido) no lo
  // toca - mismo criterio que icon/detailLayout/listLayout de arriba.
  singularName: z.string().trim().min(1).nullable().optional(),
  fiscalConfig: z.object({
    enabled: z.boolean(),
    role: z.enum(['customer', 'supplier', 'both']),
    fields: z.object({
      legalName: z.string().trim().min(1),
      taxId: z.string().trim().min(1),
      taxSystem: z.string().trim().min(1),
      postalCode: z.string().trim().min(1),
      cfdiUse: z.string().trim().min(1).optional(),
      email: z.string().trim().min(1).optional()
    })
  }).nullable().optional(),
  labelConfig: labelConfigSchema.nullable().optional()
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const id = getRouterParam(event, 'id')!
  const body = await readValidatedBody(event, bodySchema.parse)

  if (body.workflowConfig !== undefined) {
    try {
      await withTenant(auth.tenantId, tx => validateWorkflowConfig(tx, auth.tenantId, id, body.workflowConfig))
    } catch (error) {
      if (error instanceof StateWorkflowError) throw createError({ statusCode: error.statusCode, statusMessage: error.message })
      throw error
    }
  }

  if (body.labelField) {
    const isValid = await withTenant(auth.tenantId, async (tx) => {
      const [field] = await tx
        .select({ id: entityFields.id })
        .from(entityFields)
        .where(and(eq(entityFields.entityId, id), eq(entityFields.name, body.labelField!), eq(entityFields.dataType, 'text')))
        .limit(1)
      return Boolean(field)
    })
    if (!isValid) {
      throw createError({
        statusCode: 422,
        statusMessage: `"${body.labelField}" no es un campo de texto valido de este modulo`
      })
    }
  }

  if (body.boardConfig?.enabled) {
    const existing = await withTenant(auth.tenantId, async tx => tx
      .select({ name: entityFields.name, dataType: entityFields.dataType })
      .from(entityFields)
      .where(eq(entityFields.entityId, id)))
    const byName = new Map(existing.map(field => [field.name, field]))
    const statusField = body.boardConfig.statusField ? byName.get(body.boardConfig.statusField) : null
    if (!statusField || statusField.dataType !== 'select') {
      throw createError({ statusCode: 422, statusMessage: 'El campo de columnas del tablero debe ser de tipo Selección' })
    }
    const used = [body.boardConfig.titleField, ...body.boardConfig.secondaryFields].filter((name): name is string => Boolean(name))
    const missing = used.filter(name => !byName.has(name))
    if (missing.length) throw createError({ statusCode: 422, statusMessage: `El tablero referencia campos inexistentes: ${missing.join(', ')}` })
  }

  if (body.fiscalConfig?.enabled) {
    const fieldNames = Object.values(body.fiscalConfig.fields)
    const existing = await withTenant(auth.tenantId, async (tx) => tx
      .select({ name: entityFields.name })
      .from(entityFields)
      .where(and(eq(entityFields.entityId, id))))
    const existingNames = new Set(existing.map((field) => field.name))
    const missing = fieldNames.filter((name) => !existingNames.has(name))
    if (missing.length) {
      throw createError({ statusCode: 422, statusMessage: `La configuración fiscal referencia campos inexistentes: ${missing.join(', ')}` })
    }
  }

  if (body.labelConfig?.enabled) {
    const fieldNames = [body.labelConfig.titleField, body.labelConfig.subtitleField, body.labelConfig.barcodeField, ...body.labelConfig.detailFields].filter((name): name is string => !!name)
    const existing = await withTenant(auth.tenantId, async (tx) => tx
      .select({ name: entityFields.name })
      .from(entityFields)
      .where(and(eq(entityFields.entityId, id))))
    const existingNames = new Set(existing.map((field) => field.name))
    const missing = fieldNames.filter((name) => !existingNames.has(name))
    if (missing.length) throw createError({ statusCode: 422, statusMessage: `La etiqueta referencia campos inexistentes: ${missing.join(', ')}` })
  }

  const entity = await updateEntity(auth.tenantId, id, body)
  if (!entity) {
    throw createError({ statusCode: 404, statusMessage: 'Modulo no encontrado' })
  }
  return entity
})
