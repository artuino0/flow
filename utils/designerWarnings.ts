export type DesignerWarningKind = 'auto' | 'unsupported' | 'elsewhere' | 'different' | 'pending' | 'info'
export type DesignerWarningTopic = 'scheduled-notifications' | 'views' | 'reports' | 'event-notifications' | 'automations' | 'date-calculations' | 'cross-module-rules' | 'seed-data'
export type DesignerWarningItem = { kind: DesignerWarningKind; topic?: DesignerWarningTopic; text: string; details?: string[] }

export const DESIGNER_WARNING_TOPICS: Record<DesignerWarningTopic, string> = {
  'scheduled-notifications': 'Avisos programados',
  views: 'Vistas y dashboards',
  reports: 'Reportes',
  'event-notifications': 'Avisos por eventos',
  automations: 'Automatización',
  'date-calculations': 'Cálculos con fechas',
  'cross-module-rules': 'Reglas condicionales',
  'seed-data': 'Valores iniciales de catálogos'
}
const folded = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Mapa acotado: una mención de fecha, regla o módulo por sí sola no basta. */
export function designerWarningTopic(text: string): DesignerWarningTopic | undefined {
  const value = folded(text)
  if (/\b(avisos?|notificacion(?:es)?|recordatorios?|disparadores?|triggers?)\b/.test(value) && /\b(programad[oa]s?|tiempo|temporal(?:es)?|vencimientos?|dias?|horas?)\b/.test(value)) return 'scheduled-notifications'
  if (/\b(vistas?|dashboards?|tableros?)\b/.test(value)) return 'views'
  if (/\b(reportes?|informes?)\b/.test(value)) return 'reports'
  if (/\b(calcul[oa]s?|calculad[oa]s?|diferencias?|hoy|now)\b/.test(value) && /\b(fechas?|dias?|contacto|seguimientos?)\b/.test(value)) return 'date-calculations'
  if (/\b(reglas?|bloquear|impedir|condicional(?:es)?|condicion)\b/.test(value) && /entre modulos|propuesta aceptada|motivo de perdida|etapa.*perdido/.test(value)) return 'cross-module-rules'
  if (/\b(registros?|valores?|datos?)\s+iniciales\b/.test(value) && /\bcatalogos?\b/.test(value)) return 'seed-data'
  if (/\b(avisos?|notificacion(?:es)?|recordatorios?)\b/.test(value) && /\b(eventos?|crear|actualizar|borrar|eliminar)\b/.test(value)) return 'event-notifications'
  if (/\b(triggers?|automatizaciones?|automatizacion)\b/.test(value)) return 'automations'
}

export function isUnavailableDesignerView(text: string): boolean {
  const value = folded(text)
  return /\bvistas?\s+(?:guardad[oa]s?|con nombre|personalizad[oa]s?)\b/.test(value)
    || /\b(dashboards?|tableros?)\s+(?:propios?|personalizad[oa]s?|a medida|de ventas)\b/.test(value)
}

export function isDesignerAutoWarning(text: string): boolean {
  return /^Omití la asociación «.+» porque ese vínculo ya está expresado por un campo relación o Usuario\.$/.test(text)
    || /^Conservé el icono existente de .+\.$/.test(text)
    || /^Usé un icono genérico para .+; puedes cambiarlo desde el inspector\.$/.test(text)
}

export function designerWarningText(text: string): string {
  return text.replace(/^No quedó completo «([^»]+)»: /, '$1 — ')
}

/** Solo fusiona capacidades con tema conocido; conserva cada detalle y motivo. */
export function groupDesignerWarningItems(items: DesignerWarningItem[]): DesignerWarningItem[] {
  const output: DesignerWarningItem[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const capability = item.kind === 'unsupported' || item.kind === 'elsewhere'
    const topic = item.topic ?? (capability ? designerWarningTopic(item.text) : undefined)
    const text = designerWarningText(item.text)
    const key = `${item.kind}:${topic ?? ''}:${folded(text).trim()}`
    if (seen.has(key)) continue
    seen.add(key)
    if (capability && topic) {
      let group = output.find(entry => entry.kind === item.kind && entry.topic === topic)
      if (!group) { group = { kind: item.kind, topic, text: DESIGNER_WARNING_TOPICS[topic], details: [] }; output.push(group) }
      for (const detail of item.details ?? [text]) if (!group.details!.includes(detail)) group.details!.push(detail)
    } else output.push({ ...item, text })
  }
  return output
}

const categories = [
  { kind: 'different', title: 'Quedó diferente a lo que pediste' },
  { kind: 'unsupported', title: 'Todavía no disponible en Flow' },
  { kind: 'elsewhere', title: 'Se configura en otra parte de Flow' },
  { kind: 'pending', title: 'Te toca a ti' },
  { kind: 'info', title: 'Notas del diseño' }
] as const

export function designerWarningGroups(items: DesignerWarningItem[]) {
  const visible = groupDesignerWarningItems(items).filter(item => item.kind !== 'auto')
  return categories.flatMap(category => {
    const entries = visible.filter(item => item.kind === category.kind)
    const onlyCategory = visible.every(item => item.kind === category.kind)
    return entries.length ? [{ ...category, items: entries, count: entries.length, open: category.kind === 'elsewhere' ? onlyCategory : visible.length <= 3 }] : []
  })
}
