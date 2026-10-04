import { BarChart3, ClipboardList, FileText, Globe2, History, Home, Link2, PanelsTopLeft, Settings } from '@lucide/vue'

/** Una sola definición para el menú de Sites y la navegación dentro del sitio. */
export function siteNavigation(siteId: string) {
  const base = `/sites/${encodeURIComponent(siteId)}`
  return [
    { key: 'sites', label: 'SITES', items: [{ label: 'Todos los sitios', to: '/sites', icon: Globe2 }] },
    { key: 'site-content', label: 'CONTENIDO', items: [
      { label: 'Resumen', to: `${base}/overview`, icon: Home },
      { label: 'Páginas', to: `${base}/pages`, icon: FileText },
      { label: 'Landing pages', to: `${base}/landing-pages`, icon: PanelsTopLeft },
      { label: 'Formularios', to: `${base}/forms`, icon: ClipboardList },
      { label: 'Agenda', to: `${base}/agenda`, icon: ClipboardList }
    ] },
    { key: 'site-publishing', label: 'PUBLICACIÓN', items: [
      { label: 'Publicaciones', to: `${base}/publications`, icon: History },
      { label: 'Dominios y URLs', to: `${base}/domains`, icon: Link2 },
      { label: 'Analítica', to: `${base}/analytics`, icon: BarChart3 }
    ] },
    { key: 'site-settings', label: 'CONFIGURACIÓN', items: [{ label: 'Configuración', to: `${base}/settings`, icon: Settings }] }
  ]
}
