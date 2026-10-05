import type { Ref } from 'vue'
import type { SidebarPlanSnapshot } from '~/utils/sidebarPlanUsage'

export function useDesignerPlanUsage(isAdmin: Ref<boolean | null>) {
  const { user } = useAuth()
  const resource = useShellResource<Omit<SidebarPlanSnapshot, 'scope'>>('appnav-plan-usage', '/api/billing/plan-usage', () => isAdmin.value === true)
  const data = computed(() => resource.data.value ? { ...resource.data.value, scope: [user.value?.id, user.value?.tenantId, user.value?.roleId, user.value?.sessionId].join(':') } : null)
  return { ...resource, data }
}
