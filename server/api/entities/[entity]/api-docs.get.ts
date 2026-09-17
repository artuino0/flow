import { eq } from 'drizzle-orm'
import { requirePermission, getPermissionFlags } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { entityFields } from '~/server/db/schema'

// GET /api/entities/:entity/api-docs
// Referencia de integración generada a partir de los metadatos reales del módulo.
export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const { auth, entity } = await requirePermission(event, entitySlug, 'canRead')
  const fields = await withTenant(auth.tenantId, (tx) => tx
    .select({ name: entityFields.name, label: entityFields.label, dataType: entityFields.dataType, isRequired: entityFields.isRequired, validationRules: entityFields.validationRules })
    .from(entityFields)
    .where(eq(entityFields.entityId, entity.id))
    .orderBy(entityFields.sortOrder, entityFields.createdAt))
  const permissions = await getPermissionFlags(auth, entity.id)
  const origin = getRequestURL(event).origin
  const collectionPath = `/records/${entity.slug}`
  const itemPath = `${collectionPath}/{id}`
  return {
    openapi: '3.0.3',
    info: { title: `${entity.name} API`, version: '1.0.0', description: `Operaciones CRUD para el módulo ${entity.name}.` },
    servers: [{ url: `${origin}/api`, description: 'API de FlowERP' }],
    security: [{ bearerAuth: [] }],
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'API key' } },
    entity: { id: entity.id, slug: entity.slug, name: entity.name },
    fields: [{ name: 'id', label: 'ID', dataType: 'uuid', isRequired: true, validationRules: {} }, ...fields],
    permissions,
    paths: {
      [collectionPath]: {
        get: { summary: `Listar ${entity.name}`, operationId: `list${entity.slug}` },
        post: { summary: `Crear ${entity.name}`, operationId: `create${entity.slug}` }
      },
      [itemPath]: {
        get: { summary: `Consultar ${entity.name}`, operationId: `get${entity.slug}` },
        put: { summary: `Actualizar ${entity.name}`, operationId: `update${entity.slug}` },
        delete: { summary: `Eliminar ${entity.name}`, operationId: `delete${entity.slug}` }
      }
    }
  }
})
