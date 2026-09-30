import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { nextModuleListingTab } from '../../utils/moduleListingTabs'

const component = readFileSync(new URL('../../components/ModuleListLayoutCard.vue', import.meta.url), 'utf8')

describe('pestañas de configuración del listado', () => {
  it('recorre Tabla, Kanban y Calendario con las flechas y vuelve al inicio o al final', () => {
    expect(nextModuleListingTab('table', 'ArrowRight')).toBe('board')
    expect(nextModuleListingTab('board', 'ArrowRight')).toBe('calendar')
    expect(nextModuleListingTab('calendar', 'ArrowRight')).toBe('table')
    expect(nextModuleListingTab('table', 'ArrowLeft')).toBe('calendar')
    expect(nextModuleListingTab('calendar', 'ArrowLeft')).toBe('board')
    expect(nextModuleListingTab('board', 'ArrowLeft')).toBe('table')
    expect(nextModuleListingTab('calendar', 'Home')).toBe('table')
    expect(nextModuleListingTab('table', 'End')).toBe('calendar')
  })

  it('no cambia de pestaña con teclas sin acción definida', () => {
    expect(nextModuleListingTab('board', 'Enter')).toBeNull()
    expect(nextModuleListingTab('board', 'Tab')).toBeNull()
  })

  it('mantiene Tabla siempre disponible y conserva los switches y opciones de Kanban y Calendario', () => {
    expect(component).toContain('id="list-view-tab-table"')
    expect(component).toContain('Siempre activa')
    expect(component).toContain('updateBoard({ enabled: !boardConfig.enabled })')
    expect(component).toContain('updateCalendar({ enabled: !calendarConfig.enabled })')

    for (const option of [
      'boardConfig.statusField', 'boardConfig.titleField', 'boardConfig.secondaryFields', 'boardConfig.defaultView',
      'calendarConfig.startDateField', 'calendarConfig.startTimeField', 'calendarConfig.durationField', 'calendarConfig.endField',
      'calendarConfig.titleField', 'calendarConfig.colorField', 'calendarConfig.groupByField', 'calendarConfig.defaultView'
    ]) {
      expect(component).toContain(option)
    }

    expect(component).toContain('Cuando está activo, el listado se abre en Calendario.')
  })
})
