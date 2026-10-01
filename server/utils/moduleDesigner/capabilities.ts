/** Los límites de esta API se comunican aunque el proveedor omita explicarlos. */
export function designerCapabilityWarnings(instruction: string): string[] {
  const text = instruction.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const warnings: string[] = []
  if (/\b(vistas?|dashboards?|tableros?)\b/.test(text)) warnings.push('No puedo crear vistas ni dashboards desde este diseñador; el plano solo configura la estructura de los módulos.')
  if (/\b(avisos?|notificar|notificaciones?|recordatorios?)\b/.test(text)) warnings.push('No puedo crear notificaciones desde este diseñador. Automatizaciones admite avisos al crear, actualizar o borrar registros; los avisos programados por tiempo no están disponibles aquí.')
  if (/\b(triggers?|automatizaciones?)\b/.test(text)) warnings.push('Los triggers se configuran en Automatizaciones después de crear los módulos; este plano no los crea.')
  return warnings
}
