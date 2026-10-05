import type { Ref } from 'vue'
import type { BillingOverview } from '~/utils/billingOverview'

export function useBillingOverview(isAdmin: Ref<boolean | null>) {
  const { user } = useAuth()
  const resource = useShellResource<BillingOverview>('billing-overview', '/api/billing/overview', () => isAdmin.value === true)
  const data = computed(() => resource.data.value ? { ...resource.data.value, scope: [user.value?.id, user.value?.tenantId, user.value?.roleId, user.value?.sessionId].join(':') } : null)
  return { ...resource, data }
}
