import { getQuery } from 'h3'
import { requireAdminRole } from '~/server/utils/rbac'
import { getInvoiceHistory } from '~/server/utils/billing'

export default defineEventHandler(async event => {
  const auth = await requireAdminRole(event)
  const requestedTake = Number(getQuery(event).take ?? 24)
  return { invoices: await getInvoiceHistory(auth.tenantId, Number.isFinite(requestedTake) ? requestedTake : 24) }
})
