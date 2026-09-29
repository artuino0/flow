import type { Ref } from 'vue'

export function useDesignerPlanUsage(isAdmin: Ref<boolean | null>) {
  const { user } = useAuth()
  return useAsyncData('appnav-plan-usage', async () => {
    if (isAdmin.value !== true) return null
    const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
    return $fetch<{ code: string }>('/api/billing/plan-usage', { headers })
  }, { watch: [isAdmin, () => user.value?.id, () => user.value?.tenantId, () => user.value?.roleId] })
}
