import { describe, expect, it } from 'vitest'
import { agendaBlueprint, agendaBlueprintForClient, agendaStateWorkflow } from '../../server/utils/agendaTemplate'
import { blueprintSchema } from '../../server/utils/blueprint/schema'
import { MODULE_ICON_KEYS } from '../../server/utils/moduleIcons'
import { AGENDA_BASE_PROMPT } from '../../server/utils/moduleDesigner/capabilities'

describe('Plantilla Agenda 176', () => {
  it('define cinco iconos Lucide válidos y un blueprint válido', () => {
    expect(blueprintSchema.safeParse(agendaBlueprint).success).toBe(true)
    expect(agendaBlueprint.modules.map(module => module.icon)).toEqual(['Users', 'Briefcase', 'Box', 'CalendarClock', 'ListOrdered'])
    for (const module of agendaBlueprint.modules) expect(MODULE_ICON_KEYS).toContain(module.icon)
  })
  it('conserva los seis valores del Select, el inicio público y el calendario', () => {
    const base = agendaBlueprint.modules.find(module => module.slug === 'agenda-citas')!
    const options = base.fields.find(field => field.name === 'estado')!.validationRules!.options as Array<{ value: string }>
    expect(options.map(option => option.value)).toEqual(['agendada', 'confirmada', 'en_curso', 'terminada', 'cancelada', 'no_asistio'])
    expect(Object.keys(agendaStateWorkflow.states)).toEqual(options.map(option => option.value))
    expect(agendaStateWorkflow.initial).toBe('agendada')
    expect(base.calendarConfig).toMatchObject({ colorField: 'estado', groupByField: 'personal', startDateField: 'fecha', startTimeField: 'hora' })
    for (const final of ['terminada', 'cancelada', 'no_asistio']) expect(agendaStateWorkflow.transitions.filter(item => item.from === final)).toEqual([])
  })
  it('vincular clientes conserva flujo, iconos y permisos de Personal', () => {
    const linked = agendaBlueprintForClient('contactos')
    expect(linked.modules).toHaveLength(4)
    expect(linked.modules.find(module => module.slug === 'agenda-citas')!.workflow).toEqual(agendaStateWorkflow)
    expect(linked.roles!.find(role => role.name === 'Personal')!.permissions.find(permission => permission.moduleRef === 'agenda-citas')).toMatchObject({ visibility: 'own', canCreate: true, canUpdate: true, canDelete: false })
    expect(agendaBlueprint.modules).toHaveLength(5)
  })
  it('el contexto de IA conserva el flujo base sin duplicarlo', () => {
    expect(AGENDA_BASE_PROMPT).toContain('nunca propongas un flujo duplicado')
    expect(AGENDA_BASE_PROMPT).toContain('Conserva su icono y workflow existentes')
    expect(AGENDA_BASE_PROMPT).toContain('estado inicial agendada')
  })
})
