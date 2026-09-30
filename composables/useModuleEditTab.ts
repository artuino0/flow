import { computed, watch } from 'vue'
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'
import { moduleEditStepToTab, moduleEditTabToStep, normalizeModuleEditTab } from '~/utils/moduleEditTabs'

export function useModuleEditTab(route: RouteLocationNormalizedLoaded, router: Router) {
  // La ruta es la única fuente de verdad: también cubre enlaces y atrás/adelante.
  const step = computed({
    get: () => moduleEditTabToStep(route.query.tab),
    set: (value) => {
      const tab = moduleEditStepToTab(value)
      if (route.query.tab !== tab) void router.replace({ query: { ...route.query, tab } })
    }
  })

  watch(() => route.query.tab, value => {
    const tab = normalizeModuleEditTab(value)
    if (value !== tab) void router.replace({ query: { ...route.query, tab } })
  }, { immediate: true })

  return step
}
