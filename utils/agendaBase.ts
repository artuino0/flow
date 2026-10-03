const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value

export const AGENDA_CORE_FIELDS = ['fecha', 'hora', 'duracion_minutos', 'personal', 'estado', 'cliente'] as const

export function isAgendaBase(entity: { templateKey?: string | null; slug: string }) {
  return entity.templateKey === 'agenda' && entity.slug === 'agenda-citas'
}

export function mentionsAgenda(...texts: Array<string | null | undefined>) {
  const text = texts.filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return /\b(citas?|agendas?|reservas?|turnos?|appointments?|bookings?)\b/.test(text)
}

export function isAgendaCoreField(entity: { templateKey?: string | null; slug: string }, name: string) {
  return isAgendaBase(entity) && (AGENDA_CORE_FIELDS as readonly string[]).includes(name)
}

export function agendaCoreShapeChanged(current: { dataType: string; validationRules: unknown; isRequired: boolean; isOwnerField: boolean }, input: { dataType?: string; validationRules?: unknown; isRequired?: boolean; isOwnerField?: boolean }) {
  return (input.dataType !== undefined && input.dataType !== current.dataType)
    || (input.validationRules !== undefined && JSON.stringify(stable(input.validationRules)) !== JSON.stringify(stable(current.validationRules)))
    || (input.isRequired !== undefined && input.isRequired !== current.isRequired)
    || (input.isOwnerField !== undefined && input.isOwnerField !== current.isOwnerField)
}
