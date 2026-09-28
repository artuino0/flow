import { describe, expect, it } from 'vitest'
import { EMPTY_CALENDAR_CONFIG, resolveCalendarConfig } from '../../server/utils/calendarConfig'
import { validateBlueprintAgainstSnapshot } from '../../server/utils/blueprint/validate'

const fields = [
  { name: 'fecha', dataType: 'date' },
  { name: 'hora', dataType: 'text' },
  { name: 'duracion', dataType: 'number' },
  { name: 'estado', dataType: 'select' },
  { name: 'personal', dataType: 'user' },
  { name: 'asunto', dataType: 'text' }
]

describe('resolveCalendarConfig', () => {
  it('reconcilia una configuración de agenda contra sus campos', () => {
    expect(resolveCalendarConfig({
      enabled: true, startDateField: 'fecha', startTimeField: 'hora', durationField: 'duracion', endField: null,
      titleField: 'asunto', colorField: 'estado', groupByField: 'personal', defaultView: 'day'
    }, fields)).toEqual({
      enabled: true, startDateField: 'fecha', startTimeField: 'hora', durationField: 'duracion', endField: null,
      titleField: 'asunto', colorField: 'estado', groupByField: 'personal', defaultView: 'day'
    })
  })

  it('desactiva una configuración ausente o con un campo de inicio incompatible', () => {
    expect(resolveCalendarConfig(null, fields)).toEqual(EMPTY_CALENDAR_CONFIG)
    expect(resolveCalendarConfig({
      enabled: true, startDateField: 'hora', startTimeField: null, durationField: null, endField: null,
      titleField: null, colorField: null, groupByField: null, defaultView: 'week'
    }, fields).enabled).toBe(false)
  })
})

describe('calendarConfig en blueprints', () => {
  it('valida y conserva la configuración al recorrer una instantánea', async () => {
    const blueprint = {
      version: 1 as const,
      summary: 'Agenda',
      associations: [],
      modules: [{
        ref: 'citas', action: 'extend' as const, kind: 'hecho' as const, name: 'Citas', slug: 'citas', snapshot: true,
        calendarConfig: { enabled: true, startDateField: 'fecha', startTimeField: 'hora', durationField: 'duracion', endField: null, titleField: 'asunto', colorField: null, groupByField: 'personal', defaultView: 'day' as const },
        fields: [
          { name: 'fecha', label: 'Fecha', dataType: 'date' as const },
          { name: 'hora', label: 'Hora', dataType: 'text' as const },
          { name: 'duracion', label: 'Duración', dataType: 'number' as const },
          { name: 'asunto', label: 'Asunto', dataType: 'text' as const },
          { name: 'personal', label: 'Personal', dataType: 'user' as const, isOwnerField: true }
        ]
      }]
    }
    const result = await validateBlueprintAgainstSnapshot(blueprint, blueprint)
    expect(result.errors).toEqual([])
    expect(result.normalized?.modules[0]?.calendarConfig).toEqual(blueprint.modules[0].calendarConfig)
  })
})
