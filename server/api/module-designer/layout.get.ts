import { eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { moduleDesignerLayouts } from '~/server/db/schema'
import { requireDesignerAccess } from '~/server/utils/moduleDesigner/sessions'

export default defineEventHandler(async event => {
  const auth = await requireDesignerAccess(event)
  const [layout] = await withTenant(auth.tenantId, tx => tx.select({ positions: moduleDesignerLayouts.positions }).from(moduleDesignerLayouts).where(eq(moduleDesignerLayouts.tenantId, auth.tenantId)).limit(1))
  return { positions: layout?.positions ?? {} }
})
