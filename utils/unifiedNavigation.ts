import type { NavigationEntity, NavigationNode } from './moduleNavigation'
export interface NavigationLink { key: string; label: string; to: string; icon: string }
export interface NavigationArea { key: string; label: string; items: NavigationLink[]; enabled: boolean; accessible: boolean; pending?: boolean }
export interface NavigationAccess { key: string; enabled: boolean; accessible: boolean }
export function navigationEntities(nav: { groups: NavigationNode[]; unassigned: NavigationEntity[] }): NavigationEntity[] {
  const visit = (groups: NavigationNode[]): NavigationEntity[] => groups.flatMap(group => [...group.modules, ...visit(group.children)])
  return [...visit(nav.groups), ...nav.unassigned]
}
export function unifiedAreas(apps: NavigationAccess[], entities: NavigationEntity[], admin: boolean, country: string, chat: boolean, sitesPending = false): NavigationArea[] {
  const area = (key: string, label: string, items: NavigationLink[], permitted = true): NavigationArea => {
    const access = apps.find(app => app.key === key)
    return { key, label, items, enabled: access?.enabled === true, accessible: access?.accessible === true && permitted, ...(key === 'sites' ? { pending: sitesPending } : {}) }
  }
  const link = (key: string, label: string, to: string, icon: string) => ({ key, label, to, icon })
  return [
    area('core', 'Flow Core', entities.map(entity => link(`entity:${entity.id}`, entity.name, `/registros/${entity.slug}`, entity.icon || 'Blocks'))),
    area('sites', 'Sites', [link('sites:all', 'Todos los sitios', '/sites', 'Globe2'), link('sites:pages', 'Páginas', '/sites/pages', 'FileText'), link('sites:landing', 'Landing pages', '/sites/landing-pages', 'PanelsTopLeft'), link('sites:forms', 'Formularios', '/sites/forms', 'ClipboardList'), link('sites:templates', 'Plantillas', '/sites/templates', 'LayoutTemplate'), link('sites:domains', 'Dominios y URLs', '/sites/domains', 'Link2'), link('sites:analytics', 'Analítica', '/sites/analytics', 'BarChart3')]),
    area('automation', 'Automatización', [link('automation:flows', 'Flujos', '/triggers', 'Zap')], admin),
    area('billing', 'Facturación', [link('billing:documents', 'Documentos', '/facturacion', 'ReceiptText')], admin && country === 'MX'),
    area('communications', 'Comunicaciones', [link('communications:chat', 'Chat', '/chat', 'MessageCircle')], chat)
  ]
}
export function isSettingsNavigation(path: string) {
  return ['/ajustes', '/modulos', '/organizacion', '/disenador', '/catalogos', '/usuarios', '/roles'].some(prefix => path === prefix || path.startsWith(prefix + '/'))
}
