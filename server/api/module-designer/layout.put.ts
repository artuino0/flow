import { z } from 'zod'
import { withTenant } from '~/server/db'
import { moduleDesignerLayouts } from '~/server/db/schema'
import { requireDesignerAccess } from '~/server/utils/moduleDesigner/sessions'

const coordinate = z.number().finite().min(-100000).max(100000)
const bodySchema = z.object({ positions: z.record(z.object({ x: coordinate, y: coordinate }).strict()) }).strict().refine(value => Object.keys(value.positions).length <= 500, 'Hay demasiados módulos en el acomodo')

export default defineEventHandler(async event => {
  const auth = await requireDesignerAccess(event)
  const { positions } = await readValidatedBody(event, bodySchema.parse)
  await withTenant(auth.tenantId, tx => tx.insert(moduleDesignerLayouts).values({ tenantId: auth.tenantId, positions }).onConflictDoUpdate({ target: moduleDesignerLayouts.tenantId, set: { positions, updatedAt: new Date() } }))
  return { positions }
})
