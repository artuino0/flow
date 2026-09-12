import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { withTenant } from '~/server/db'
import { entities, tenants } from '~/server/db/schema'
import { requireAdminRole } from '~/server/utils/rbac'
import { navigationLayoutSchema } from '~/utils/moduleNavigation'

const schema = z.object({ layout: navigationLayoutSchema, revision: z.number().int().nonnegative() })
export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, schema.parse)
  return withTenant(auth.tenantId, async tx => {
    const owned = await tx.select({ id: entities.id }).from(entities).where(and(eq(entities.tenantId, auth.tenantId), eq(entities.moduleKind, 'hecho')))
    const ids = new Set(owned.map(entity => entity.id))
    if (body.layout.groups.some(group => group.entityIds.some(id => !ids.has(id)))) {
      throw createError({ statusCode: 400, statusMessage: 'Solo puedes asignar módulos operativos de tu organización; los catálogos se usan desde los selectores.' })
    }
    const [saved] = await tx.update(tenants).set({ navigationLayout: body.layout, navigationRevision: sql`${tenants.navigationRevision} + 1` })
      .where(and(eq(tenants.id, auth.tenantId), eq(tenants.navigationRevision, body.revision)))
      .returning({ layout: tenants.navigationLayout, revision: tenants.navigationRevision })
    if (!saved) throw createError({ statusCode: 409, statusMessage: 'Otra persona cambió la organización del menú. Recarga antes de guardar.' })
    return saved
  })
})
