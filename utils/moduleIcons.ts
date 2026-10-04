import { Blocks } from '@lucide/vue'
import { defineAsyncComponent, type Component } from 'vue'

const components = new Map<string, Component>()
/** Conserva cada glifo del catálogo; carga únicamente el icono solicitado. */
export function moduleIconComponent(key: string | null | undefined): Component {
  if (!key) return Blocks
  let component = components.get(key)
  if (!component) {
    component = defineAsyncComponent(async () => {
      const { loadModuleIcon } = await import('./moduleIconLoaders')
      return await loadModuleIcon(key) ?? Blocks
    })
    components.set(key, component)
  }
  return component
}
