export const MODULE_EDIT_TABS = {
  basica: 'info',
  campos: 'fields',
  relaciones: 'relations',
  navegacion: 'menu',
  detalle: 'detail',
  listado: 'list',
  flujo: 'flow',
  etiquetas: 'labels',
  api: 'api'
} as const

export type ModuleEditStep = keyof typeof MODULE_EDIT_TABS
export type ModuleEditTab = (typeof MODULE_EDIT_TABS)[ModuleEditStep]

export function moduleEditTabToStep(value: unknown): ModuleEditStep {
  return (Object.keys(MODULE_EDIT_TABS) as ModuleEditStep[]).find(key => MODULE_EDIT_TABS[key] === value) ?? 'basica'
}

export function moduleEditStepToTab(step: ModuleEditStep): ModuleEditTab {
  return MODULE_EDIT_TABS[step]
}

export function normalizeModuleEditTab(value: unknown): ModuleEditTab {
  return moduleEditStepToTab(moduleEditTabToStep(value))
}
