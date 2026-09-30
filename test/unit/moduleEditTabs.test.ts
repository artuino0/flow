import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive } from 'vue'
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'
import { MODULE_EDIT_TABS, moduleEditStepToTab, moduleEditTabToStep, normalizeModuleEditTab } from '../../utils/moduleEditTabs'
import { useModuleEditTab } from '../../composables/useModuleEditTab'

describe('pestañas de edición de módulo', () => {
  it('convierte las nueve claves en ambas direcciones', () => {
    const pairs = [
      ['basica', 'info'], ['campos', 'fields'], ['relaciones', 'relations'],
      ['navegacion', 'menu'], ['detalle', 'detail'], ['listado', 'list'],
      ['flujo', 'flow'], ['etiquetas', 'labels'], ['api', 'api']
    ] as const
    expect(Object.entries(MODULE_EDIT_TABS)).toEqual(pairs)
    for (const [step, tab] of pairs) {
      expect(moduleEditStepToTab(step)).toBe(tab)
      expect(moduleEditTabToStep(tab)).toBe(step)
      expect(normalizeModuleEditTab(tab)).toBe(tab)
    }
  })

  it.each([undefined, null, '', 'campos', 'FIELDS', 'invalid', ['fields'], ['fields', 'api'], 1])('normaliza %j a info', value => {
    expect(moduleEditTabToStep(value)).toBe('basica')
    expect(normalizeModuleEditTab(value)).toBe('info')
  })

  it.each([undefined, 'invalid', ['fields']])('normaliza la URL inicial %j sin perder parámetros ni hash', async tab => {
    const route = reactive({ query: { tab, source: 'test' }, hash: '#section' }) as unknown as RouteLocationNormalizedLoaded
    const replace = vi.fn(async (location: { query: RouteLocationNormalizedLoaded['query'] }) => { route.query = location.query })
    const scope = effectScope()
    const step = scope.run(() => useModuleEditTab(route, { replace } as unknown as Router))!
    await nextTick()
    expect(step.value).toBe('basica')
    expect(route.query).toEqual({ tab: 'info', source: 'test' })
    expect(route.hash).toBe('#section')
    expect(replace).toHaveBeenCalledExactlyOnceWith({ query: { tab: 'info', source: 'test' } })
    scope.stop()
  })

  it('carga enlaces directos, sincroniza asignaciones y navegación externa sin bucles', async () => {
    const route = reactive({ query: { tab: 'fields', source: 'test' } }) as unknown as RouteLocationNormalizedLoaded
    const replace = vi.fn(async (location: { query: RouteLocationNormalizedLoaded['query'] }) => { route.query = location.query })
    const scope = effectScope()
    const step = scope.run(() => useModuleEditTab(route, { replace } as unknown as Router))!
    expect(step.value).toBe('campos')
    expect(replace).not.toHaveBeenCalled()
    step.value = 'detalle'
    await nextTick()
    expect(route.query).toEqual({ tab: 'detail', source: 'test' })
    expect(step.value).toBe('detalle')
    expect(replace).toHaveBeenCalledTimes(1)
    step.value = 'detalle'
    route.query = { tab: 'api', source: 'external' }
    await nextTick()
    expect(step.value).toBe('api')
    expect(replace).toHaveBeenCalledTimes(1)
    route.query = { source: 'external' }
    await nextTick()
    expect(step.value).toBe('basica')
    expect(route.query).toEqual({ tab: 'info', source: 'external' })
    expect(replace).toHaveBeenCalledTimes(2)
    scope.stop()
  })
})
