import { Blocks, Database, Globe2, MessageCircleMore, ReceiptText, Settings, Zap } from '@lucide/vue'

export const FLOW_APP_KEYS = ['core', 'automation', 'communications', 'sites', 'billing', 'settings'] as const
export type FlowAppKey = typeof FLOW_APP_KEYS[number]

export interface FlowAppDefinition {
  key: FlowAppKey
  label: string
  description: string
  home: string
  icon: typeof Blocks
}

export const FLOW_APPS: Record<FlowAppKey, FlowAppDefinition> = {
  core: { key: 'core', label: 'Flow Core', description: 'Datos y operación', home: '/', icon: Database },
  automation: { key: 'automation', label: 'Automatización', description: 'Flujos y eventos', home: '/triggers', icon: Zap },
  communications: { key: 'communications', label: 'Comunicaciones', description: 'Equipo y clientes', home: '/chat', icon: MessageCircleMore },
  sites: { key: 'sites', label: 'Sites', description: 'Páginas y formularios', home: '/sites', icon: Globe2 },
  billing: { key: 'billing', label: 'Facturación', description: 'Documentos fiscales', home: '/facturacion', icon: ReceiptText },
  settings: { key: 'settings', label: 'Ajustes', description: 'Usuarios y configuración', home: '/ajustes', icon: Settings }
}

export const FLOW_APP_LIST = FLOW_APP_KEYS.map(key => FLOW_APPS[key])

const APP_PREFIXES: Array<[FlowAppKey, string[]]> = [
  ['communications', ['/chat', '/comunicaciones']],
  ['automation', ['/triggers', '/automatizacion']],
  ['sites', ['/sites']],
  ['billing', ['/facturacion', '/facturacion-print']],
  ['settings', ['/ajustes', '/mi-cuenta', '/usuarios', '/roles', '/modulos', '/organizacion', '/catalogos', '/activar']]
]

export function resolveFlowApp(path: string): FlowAppKey {
  for (const [key, prefixes] of APP_PREFIXES) {
    if (prefixes.some(prefix => path === prefix || path.startsWith(`${prefix}/`))) return key
  }
  return 'core'
}

