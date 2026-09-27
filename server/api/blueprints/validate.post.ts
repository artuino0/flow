import { requireAdminRole } from '~/server/utils/rbac'
import { validateBlueprint } from '~/server/utils/blueprint/validate'
import { diffBlueprint } from '~/server/utils/blueprint/diff'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const body = await readBody(event)
  const checked = await validateBlueprint(auth.tenantId, body)
  return { normalized: checked.normalized, errors: checked.errors, merges: checked.merges, diff: await diffBlueprint(auth.tenantId, checked) }
})
