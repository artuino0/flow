import type { Component } from 'vue'
import paths from './moduleIconPaths.json'

const loaders = import.meta.glob<{ default: Component }>(['../node_modules/@lucide/vue/dist/esm/icons/*.mjs', '!../node_modules/@lucide/vue/dist/esm/icons/index.mjs'])
export async function loadModuleIcon(key: string): Promise<Component | undefined> {
  const file = (paths as Record<string, string>)[key]
  const load = file ? loaders[`../node_modules/@lucide/vue/dist/esm/icons/${file}`] : undefined
  return load ? (await load()).default : undefined
}
