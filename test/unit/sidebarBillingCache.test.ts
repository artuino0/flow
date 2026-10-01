import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useDesignerPlanUsage } from '../../composables/useDesignerPlanUsage'
import { useBillingOverview } from '../../composables/useBillingOverview'

describe('caché compartida de consumo administrativo', () => {
  afterEach(() => vi.unstubAllGlobals())
  it.each([useDesignerPlanUsage, useBillingOverview])('%s protege permisos e identidad y deduplica peticiones', async composable => {
    const user = ref({ id: 'u', tenantId: 't', roleId: 'r', sessionId: 's' })
    const admin = ref<boolean | null>(null)
    const fetch = vi.fn().mockResolvedValue({ plan: 'Crecimiento', code: 'crecimiento', usage: [] })
    vi.stubGlobal('useAuth', () => ({ user }))
    vi.stubGlobal('$fetch', fetch)
    let handler!: () => Promise<unknown>
    let cache!: (key: string, app: { payload: { data: Record<string, unknown> }; static: { data: Record<string, unknown> } }, ctx: { cause: string }) => unknown
    let key = ''
    vi.stubGlobal('useAsyncData', (receivedKey: string, receivedHandler: typeof handler, options: { getCachedData: typeof cache; dedupe: string }) => {
      key = receivedKey; handler = receivedHandler; cache = options.getCachedData
      expect(options.dedupe).toBe('defer')
      return {}
    })
    composable(admin)
    expect(await handler()).toBeNull()
    admin.value = false
    expect(await handler()).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    admin.value = true
    const snapshot = await handler()
    const app = { payload: { data: { [key]: snapshot } }, static: { data: {} } }
    expect(cache(key, app, { cause: 'initial' })).toBe(snapshot)
    expect(cache(key, app, { cause: 'refresh:manual' })).toBeUndefined()
    expect(cache(key, app, { cause: 'watch' })).toBeUndefined()
    user.value.tenantId = 'other'
    expect(cache(key, app, { cause: 'initial' })).toBeUndefined()
    user.value.tenantId = 't'
    user.value.sessionId = 'new-session'
    expect(cache(key, app, { cause: 'initial' })).toBeUndefined()
    user.value.sessionId = 's'
    admin.value = false
    expect(cache(key, app, { cause: 'initial' })).toBeUndefined()
  })
})
