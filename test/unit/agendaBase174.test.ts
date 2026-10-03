import { describe, expect, it } from 'vitest'
import { agendaCoreShapeChanged, isAgendaBase, isAgendaCoreField, mentionsAgenda } from '../../utils/agendaBase'
import { AGENDA_BASE_PROMPT } from '../../server/utils/moduleDesigner/capabilities'

describe('Citas base 174', () => {
  it.each(['CITA', 'Cítas', 'AGÉNDA médica', 'reserva', 'turnos', 'Appointment', 'bookings', 'citas bibliográficas'])('pregunta por %s', text => expect(mentionsAgenda(text)).toBe(true))
  it.each(['capacitación', 'reservado', 'agendamiento', 'contabilidad', ''])('no pregunta por %s', text => expect(mentionsAgenda(text)).toBe(false))
  it('detecta en descripción y requiere huella real para proteger', () => {
    expect(mentionsAgenda('Atención', 'Reservas por persona')).toBe(true)
    expect(isAgendaBase({ slug: 'agenda-citas', templateKey: null })).toBe(false)
    expect(isAgendaBase({ slug: 'agenda-citas', templateKey: 'agenda' })).toBe(true)
    for (const name of ['fecha', 'hora', 'duracion_minutos', 'personal', 'estado', 'cliente']) expect(isAgendaCoreField({ slug: 'agenda-citas', templateKey: 'agenda' }, name)).toBe(true)
    expect(isAgendaCoreField({ slug: 'agenda-citas', templateKey: 'agenda' }, 'propio')).toBe(false)
  })
  it('permite etiquetas y metadata idéntica con distinto orden, rechaza cambios reales', () => {
    const field = { dataType: 'relation', validationRules: { relationEntity: 'clientes', unique: true }, isRequired: true, isOwnerField: false }
    expect(agendaCoreShapeChanged(field, {})).toBe(false)
    expect(agendaCoreShapeChanged(field, { ...field, validationRules: { unique: true, relationEntity: 'clientes' } })).toBe(false)
    for (const change of [{ dataType: 'text' }, { isRequired: false }, { isOwnerField: true }, { validationRules: { relationEntity: 'otro' } }]) expect(agendaCoreShapeChanged(field, change)).toBe(true)
  })
  it('el registro de capacidades explica el base y conserva extensiones y partidas', () => {
    expect(AGENDA_BASE_PROMPT).toContain('systemTemplate="agenda"')
    expect(AGENDA_BASE_PROMPT).toContain('action extend')
    expect(AGENDA_BASE_PROMPT).toContain('partidas propias')
  })
})
