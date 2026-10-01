import type { Ref } from 'vue'
import type { BillingOverview } from '~/utils/billingOverview'

export function useBillingOverview(isAdmin: Ref<boolean | null>) {
  const { user } = useAuth()
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
  const scope = () => [user.value?.id, user.value?.tenantId, user.value?.roleId, user.value?.sessionId].join(':')
  return useAsyncData('billing-overview', async () => {
    if (isAdmin.value !== true) return null
    const requestScope = scope()
    const overview = await $fetch<BillingOverview>('/api/billing/overview', { headers })
    return { ...overview, scope: requestScope }
  }, {
    dedupe: 'defer',
    watch: [isAdmin, scope],
    getCachedData: (key, nuxtApp, ctx) => {
      if (ctx.cause !== 'initial') return undefined
      const cached = nuxtApp.payload.data[key] ?? nuxtApp.static.data[key]
      return cached?.scope === scope() && isAdmin.value === true ? cached : undefined
    }
  })
}
