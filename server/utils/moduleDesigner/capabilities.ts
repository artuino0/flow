import { designerWarningTopic, isUnavailableDesignerView, type DesignerWarningItem, type DesignerWarningKind } from '~/utils/designerWarnings'
import { FIELD_VALIDATIONS } from '~/server/utils/fieldValidations/registry'

/** El tipo de estado se toma del registro de opciones, sin otra lista de parámetros. */
export function designerStructureCriteriaPrompt() {
  const stateType = Object.keys(FIELD_VALIDATIONS.find(rule => rule.id === 'options')?.variants ?? {}).find(type => type === 'select')
  return `Criterio de estructura: etapas, estados y estatus de un proceso se modelan como ${stateType ?? 'Select'} o flujo de estados, nunca como catálogo. Un catálogo nuevo solo se crea si algún campo relation lo va a usar. No dupliques el mismo concepto como catálogo y como Select. Si el usuario pide un catálogo que no se usa, decláralo en omissions y explica la representación elegida; si lo pide explícitamente independiente, consérvalo.`
}

// Nombres verificados en flowApps/AppNav, páginas y ModuleListLayoutCard; no son destinos inventados.
export const DESIGNER_SCOPE_PROMPT = `El diseñador crea estructura, no configura el resto de Flow. Etiqueta elsewhere lo que se hace en otra sección existente: vistas Tabla, Kanban y Calendario en Editar módulo > Listado de registros; reportes en Reportes; avisos por eventos crear, actualizar o borrar en Automatización (navegación Flujos); el resumen operativo existente y sus accesos rápidos en Tablero. Tablero no es un editor de dashboards propios y no hay vistas guardadas con nombre: esas peticiones son unsupported. También son unsupported los avisos o disparadores programados por tiempo, los cálculos con fecha actual o entre fechas y las reglas condicionales entre módulos. No presentes elsewhere como pérdida ni uses «No quedó completo». No inventes secciones, rutas ni capacidades.`

/** Los límites de esta API se comunican aunque el proveedor omita explicarlos. */
export function designerCapabilityWarnings(instruction: string): string[] {
  const text = instruction.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const warnings: string[] = []
  if (/\b(vistas?|dashboards?|tableros?)\b/.test(text)) warnings.push('No puedo crear vistas ni dashboards desde este diseñador; el plano solo configura la estructura de los módulos.')
  if (/\b(avisos?|notificar|notificacion(?:es)?|recordatorios?)\b/.test(text)) warnings.push('No puedo crear notificaciones desde este diseñador. Automatizaciones admite avisos al crear, actualizar o borrar registros; los avisos programados por tiempo no están disponibles aquí.')
  if (/\b(triggers?|disparadores?|automatizacion(?:es)?)\b/.test(text)) warnings.push('Los triggers se configuran en Automatizaciones después de crear los módulos; este plano no los crea.')
  if (/\b(reportes?|informes?)\b/.test(text)) warnings.push('Los reportes se configuran en Reportes; este plano solo configura la estructura de los módulos.')
  return warnings
}

/** Corrige etiquetas de capacidades conocidas sin cambiar el plano ni asumir pérdidas desconocidas. */
export function designerClassifiedWarningItem(kind: DesignerWarningKind, item: string, reason = ''): DesignerWarningItem {
  const text = reason ? `${item} — ${reason}` : item
  if (!['unsupported', 'elsewhere'].includes(kind)) return { kind, text }
  // La capacidad se identifica por el elemento pedido, no por una lista de limitaciones en su motivo.
  const topic = designerWarningTopic(item) ?? designerWarningTopic(text)
  if (topic === 'views') {
    if (isUnavailableDesignerView(text)) return { kind: 'unsupported', topic, text }
    const dashboard = /\b(dashboards?|tableros?)\b/i.test(item)
    return { kind: 'elsewhere', topic, text: `${item} — ${dashboard ? 'El resumen operativo está en Tablero; allí puedes personalizar los accesos rápidos.' : 'Configura Tabla, Kanban y Calendario en Editar módulo, en Listado de registros.'}` }
  }
  if (topic === 'reports') return { kind: 'elsewhere', topic, text: `${item} — Configúralos en Reportes.` }
  if (topic === 'event-notifications' || topic === 'automations') return { kind: 'elsewhere', topic, text: `${item} — Configúralos en Automatización, en Flujos, al crear, actualizar o borrar registros.` }
  if (['scheduled-notifications', 'date-calculations', 'cross-module-rules'].includes(topic ?? '')) return { kind: 'unsupported', topic, text }
  return { kind, text }
}

export function designerCapabilityWarningItems(instruction: string): DesignerWarningItem[] {
  return designerCapabilityWarnings(instruction).flatMap((text): DesignerWarningItem | DesignerWarningItem[] => {
    if (text.startsWith('No puedo crear vistas')) {
      if (isUnavailableDesignerView(instruction)) return { kind: 'unsupported', topic: 'views', text: 'Vistas guardadas y dashboards propios — Todavía no hay un editor para crearlos. Las vistas Tabla, Kanban y Calendario y el Tablero operativo existente se configuran fuera de este diseñador.' }
      return { kind: 'elsewhere', topic: 'views', text: 'Vistas y tablero — Configura Tabla, Kanban y Calendario en Editar módulo, en Listado de registros. El resumen operativo está en Tablero, donde puedes personalizar los accesos rápidos.' }
    }
    if (text.startsWith('No puedo crear notificaciones')) {
      const event: DesignerWarningItem = { kind: 'elsewhere', topic: 'event-notifications', text: 'Avisos por eventos — Configúralos en Automatización, en Flujos, al crear, actualizar o borrar registros.' }
      if (designerWarningTopic(instruction) === 'scheduled-notifications') {
        const scheduled: DesignerWarningItem = { kind: 'unsupported', topic: 'scheduled-notifications', text: 'Avisos programados — Los avisos programados por tiempo todavía no están disponibles.' }
        const explicitEvents = /\b(?:avisos?|notificacion(?:es)?|recordatorios?)\s+(?:por eventos|al (?:crear|actualizar|borrar|eliminar))\b/.test(instruction.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())
        return explicitEvents ? [scheduled, event] : scheduled
      }
      return event
    }
    if (text.startsWith('Los reportes')) return { kind: 'elsewhere', topic: 'reports', text: 'Reportes — Configúralos en Reportes después de crear los módulos.' }
    if (designerWarningTopic(instruction) === 'scheduled-notifications') return { kind: 'unsupported', topic: 'scheduled-notifications', text: 'Disparadores programados — Los disparadores por tiempo todavía no están disponibles; Automatización admite eventos al crear, actualizar o borrar registros.' }
    return { kind: 'elsewhere', topic: 'automations', text: 'Flujos — Configura los triggers en Automatización después de crear los módulos.' }
  })
}
