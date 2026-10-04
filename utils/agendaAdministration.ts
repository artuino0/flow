import type { AgendaSiteConfig } from './agendaPublic'
import { analyzeAgendaMarkers } from './agendaMarkers'

export interface AgendaAdministrationState {
  ownStaff?: { id: string; administrator: boolean; scheduled: boolean } | null; scheduledOtherRoles?: string[]
  settings: AgendaSiteConfig; available: boolean; reason: string | null
  services: Array<{ id: string; name: string }>
  people: Array<{ id: string; name: string; scheduled?: boolean }>
}
export function agendaReadiness(data: AgendaAdministrationState, siteId: string, publishedPage: string | null) {
  const scheduled = data.people.filter(person => person.scheduled)
  return [
    { key: 'base', ready: data.available || data.reason === 'Configura horarios del personal.', label: 'Citas base instalado', links: [{ label: 'Instala Citas base', to: '/modulos/nuevo' }] },
    { key: 'services', ready: data.services.length > 0, label: 'Al menos un servicio', links: [{ label: 'Crear servicio', to: '/registros/agenda-servicios' }] },
    { key: 'schedules', ready: scheduled.length > 0, label: data.ownStaff?.administrator && !data.ownStaff.scheduled ? 'Tu usuario aún no tiene horario de agenda' : 'Personal con horario definido', links: [{ label: 'Definir horario', to: '/usuarios' }, { label: 'Ajustes → Agenda', to: '/ajustes?section=agenda' }] },
    { key: 'visible', ready: scheduled.some(person => !data.settings.personalIds.length || data.settings.personalIds.includes(person.id)), label: 'Personal visible con horario', links: [{ label: 'Mostrar personal', to: '#agenda-personal' }] },
    { key: 'enabled', ready: data.settings.enabled, label: 'Agenda activada en este sitio', links: [{ label: 'Activar agenda', to: '#agenda-enabled' }] },
    { key: 'published', ready: !!publishedPage, label: 'Una página publicada con el marcador de agenda', links: [{ label: 'Insertar marcador', to: `/sites/${encodeURIComponent(siteId)}/pages` }] }
  ]
}

/** Solo mensajes públicos de validación; nunca trazas o detalles del servidor. */
export function agendaAdministrationError(error: unknown, action: 'load' | 'save') {
  const err = error as { statusCode?: number; status?: number; response?: { status?: number }; data?: { statusMessage?: string; message?: string }; statusMessage?: string } | null
  const status = Number(err?.statusCode ?? err?.status ?? err?.response?.status ?? 0)
  if (status === 403) return 'No tienes permiso para administrar la agenda. Pídele acceso a un administrador'
  if (status === 404) return 'No encontramos este sitio'
  if (!status) return 'Sin conexión. Reintenta'
  if (status === 422 || status === 409) {
    const message = err?.data?.statusMessage ?? err?.data?.message ?? err?.statusMessage
    if (typeof message === 'string' && message.trim() && message.length <= 500 && !/[\r\n<>]|(?:select\s|insert\s|update\s|postgres|sqlstate|stack|node_modules|password|secret|token|:\\|\.vue:\d|\.ts:\d)/i.test(message)) return message.trim()
    return 'Revisa la configuración de la agenda y vuelve a intentarlo.'
  }
  return `No pudimos ${action === 'save' ? 'guardar' : 'cargar'} la agenda por un error del servidor. Inténtalo en unos minutos; si sigue, avisa a soporte`
}

/** Inspección de texto en el cliente: no inserta el documento ni ejecuta su runtime. */
export function publishedDocumentHasAgenda(html: string) {
  if (analyzeAgendaMarkers(html).some(marker => marker.kind !== 'invalid')) return true
  const document = new DOMParser().parseFromString(html, 'text/html')
  return [...document.querySelectorAll('div[data-flow-agenda="inline"],button[data-flow-agenda-open],a[data-flow-agenda-open]')]
    .some(node => !node.closest('template,svg,math,noscript'))
}
