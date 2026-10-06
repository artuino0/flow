import type { NavigationEntity, NavigationNode } from '~/utils/moduleNavigation'
import { navigationEntities, unifiedAreas } from '~/utils/unifiedNavigation'
export function useUnifiedNavigation() {
  const { user } = useAuth(), chat = useChat()
  const { data: access, load } = useFlowAppAccess()
  const nav = useShellResource<{ groups: NavigationNode[]; unassigned: NavigationEntity[] }>('appnav-modules', '/api/nav/entities', () => true, false)
  const canSites = () => access.value?.apps.some(app => app.key === 'sites' && app.enabled && app.accessible) === true
  const sites = useShellResource<{ sites: { id: string }[] }>('flow-navigation-sites', '/api/sites', canSites)
  const entities = computed(() => nav.data.value ? navigationEntities(nav.data.value) : [])
  const areas = computed(() => unifiedAreas(access.value?.apps ?? [], entities.value, user.value?.isAdmin === true, user.value?.country || '', chat.canAccess.value, sites.data.value?.sites.length === 0))
  const pins = useShellResource<{ keys: string[] }>('navigation-pins', '/api/navigation/pins', () => true, false)
  const pinBusy = useState('navigation-pin-busy', () => false), pinError = useState('navigation-pin-error', () => '')
  const pinned = computed(() => {
    const items = areas.value.filter(area => area.enabled && area.accessible).flatMap(area => area.items)
    return (pins.data.value?.keys ?? []).flatMap(key => items.find(item => item.key === key) ? [items.find(item => item.key === key)!] : [])
  })
  async function togglePin(key: string) {
    if (pinBusy.value) return
    pinBusy.value = true; pinError.value = ''
    try { await $fetch('/api/navigation/pins', { method: 'PUT', body: { key, pinned: !pins.data.value?.keys?.includes(key) } }); await pins.refresh() }
    catch (error) { pinError.value = (error as { data?: { statusMessage?: string } })?.data?.statusMessage || 'No se pudo guardar el anclado. Inténtalo de nuevo.' }
    finally { pinBusy.value = false }
  }
  const quickCreate = computed(() => areas.value.find(area => area.key === 'core')?.accessible && areas.value.find(area => area.key === 'core')?.enabled ? entities.value.filter(entity => entity.canCreate).slice(0,8) : [])
  return { nav, areas, pinned, pins, pinBusy, pinError, togglePin, quickCreate, load }
}
