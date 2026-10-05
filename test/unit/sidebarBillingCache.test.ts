import { afterEach, describe, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { useDesignerPlanUsage } from '../../composables/useDesignerPlanUsage'
import { useBillingOverview } from '../../composables/useBillingOverview'
import { loadNuxtSource183 } from '../helpers/nuxt183'

describe('caché compartida de consumo administrativo', () => {
  afterEach(() => vi.unstubAllGlobals())
  it.each([useDesignerPlanUsage, useBillingOverview])('%s protege permisos e identidad y deduplica peticiones', async composable => {
    const user = vue.ref({ authenticated: true, id: 'u', tenantId: 't', roleId: 'r', sessionId: 's' })
    const admin = vue.ref<boolean | null>(null)
    const fetch = vi.fn().mockResolvedValue({ plan: 'Crecimiento', code: 'crecimiento', usage: [] })
    const states = new Map<string, vue.Ref>(), app = {}
    const globals = { ...vue, useAuth: () => ({ user }), $fetch: fetch, useNuxtApp: () => app,
      useAfterFirstPaint: () => async () => {}, useState: (key: string, init: () => unknown) => {
        if (!states.has(key)) states.set(key, vue.ref(init())); return states.get(key)!
      } }
    const resource = loadNuxtSource183('composables/useShellResource.ts', globals).useShellResource
    for (const [key, value] of Object.entries({ ...globals, useShellResource: resource })) vi.stubGlobal(key, value)
    const first = composable(admin), second = composable(admin)
    expect(await first.execute()).toBeNull()
    admin.value = false
    expect(await first.execute()).toBeNull(); expect(fetch).not.toHaveBeenCalled()
    admin.value = true
    await Promise.all([first.execute(), second.execute()])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(first.data.value).toMatchObject({ scope: 'u:t:r:s', plan: 'Crecimiento' })
    expect(second.data.value).toEqual(first.data.value)
    await first.execute(); expect(fetch).toHaveBeenCalledTimes(1)
    await first.refresh(); expect(fetch).toHaveBeenCalledTimes(2)
    user.value.tenantId = 'other'; expect(first.data.value).toBeNull()
    await first.execute(); expect(first.data.value?.scope).toBe('u:other:r:s'); expect(fetch).toHaveBeenCalledTimes(3)
    user.value.tenantId = 't'; user.value.sessionId = 'new-session'; expect(first.data.value).toBeNull()
    await first.execute(); expect(first.data.value?.scope).toBe('u:t:r:new-session'); expect(fetch).toHaveBeenCalledTimes(4)
    user.value.sessionId = 's'; admin.value = false
    expect(first.data.value).toBeNull(); expect(await first.execute()).toBeNull(); expect(fetch).toHaveBeenCalledTimes(4)
  })
})
