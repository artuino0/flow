import { asc } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { tenantLimitOverrides, tenants } from '~/server/db/schema'
import { requirePlatformAdmin } from '~/server/utils/platformAdmin'
import { listPlans } from '~/server/utils/plans'

export default defineEventHandler(async event => {
  await requirePlatformAdmin(event)
  const [plans, organizations] = await Promise.all([
    listPlans(),
    db.select({ id: tenants.id, name: tenants.name, slug: tenants.slug }).from(tenants).orderBy(asc(tenants.name))
  ])
  const overrides = (await Promise.all(organizations.map(async organization => withTenant(organization.id, tx => tx.select().from(tenantLimitOverrides))))).flat()
  return { plans, organizations, overrides }
})
