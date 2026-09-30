import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse, compileTemplate } from '@vue/compiler-sfc'
import { MODULE_EDIT_TABS } from '../../utils/moduleEditTabs'
import { recommendedTourForContext } from '../../utils/chattitoContext'
import { chattitoHelpCatalog } from '../../utils/chattitoHelp'
import { MODULE_EDIT_TOURS, MODULE_EDIT_TAB_ANCHORS, TOUR_SELECTORS, canRunTour, isModuleEditTour, moduleEditTourMatchesRoute, onboardingTours, readTourProgress, tourStepDestination, visibleTourSteps, type TourId } from '../../utils/onboardingTours'

const page = 'pages/modulos/[id]/editar.vue'
const filesByTab = {
  info: [page], fields: [page, 'components/ModuleFieldsCard.vue'],
  relations: [page, 'components/ModuleRelationsCard.vue'],
  menu: [page, 'components/ModuleNavigationEditor.vue'],
  detail: [page, 'components/ModuleDetailLayoutCard.vue'],
  list: [page, 'components/ModuleListLayoutCard.vue'],
  flow: [page, 'components/ModuleStateWorkflowCard.vue'],
  labels: [page, 'components/ModuleLabelEditor.vue'],
  api: [page, 'components/ModuleApiDocs.vue']
} as const
const template = (file: string) => parse(readFileSync(file, 'utf8')).descriptor.template!.content

describe('recorridos informativos de edición', () => {
  it.each(Object.entries(MODULE_EDIT_TABS))('%s tiene un recorrido real en su propia pestaña', (stepKey, tab) => {
    const id = MODULE_EDIT_TOURS[tab]
    const tour = onboardingTours[id]
    expect(tour.id).toBe(id)
    expect(tour.requires).toEqual(['settings.modules'])
    expect(tour.steps.length).toBeGreaterThanOrEqual(3)
    expect(tour.steps.length).toBeLessThanOrEqual(6)
    expect(tour.steps[0]?.selector).toBe(`[data-tour="${MODULE_EDIT_TAB_ANCHORS[stepKey as keyof typeof MODULE_EDIT_TAB_ANCHORS]}"]`)
    const markup = filesByTab[tab].map(template).join('\n')
    expect(template(page)).toContain(':data-tour="MODULE_EDIT_TAB_ANCHORS[tab.key]"')
    for (const [index, step] of tour.steps.entries()) {
      expect(Object.values(TOUR_SELECTORS)).toContain(step.selector)
      expect(step.title.trim()).not.toBe('')
      expect(step.text.trim()).not.toBe('')
      for (const key of ['waitForClick', 'completeWhen', 'interactive', 'action', 'path', 'kind'] as const) expect(step[key]).toBeUndefined()
      if (index > 0) expect(markup).toContain(step.selector!.slice(1, -1))
    }
    expect(canRunTour(tour, { isAdmin: true, designerAvailable: false })).toBe(true)
    expect(canRunTour(tour, { isAdmin: false, designerAvailable: true })).toBe(false)
    expect(chattitoHelpCatalog[`module-edit:${tab}`].tourId).toBe(id)
    expect(recommendedTourForContext({ page: 'module-edit', tab, moduleId: 'actual' })).toBe(id)
    expect(moduleEditTourMatchesRoute(id, '/modulos/actual/editar', tab)).toBe(true)
    expect(moduleEditTourMatchesRoute(id, '/modulos/actual/editar', tab === 'info' ? 'fields' : 'info')).toBe(false)
    expect(moduleEditTourMatchesRoute(id, '/modulos/nuevo', tab)).toBe(false)
    expect(isModuleEditTour(id)).toBe(true)
  })

  it('mantiene compilables los templates y conserva los anclajes manuales', () => {
    for (const file of new Set(Object.values(filesByTab).flat())) {
      expect(compileTemplate({ source: template(file), filename: file, id: file }).errors).toEqual([])
    }
    const fields = template('components/ModuleFieldsCard.vue')
    expect(fields).toContain('data-tour="manual-field-add"')
    expect(fields).toContain('data-tour="manual-field-saved"')
  })

  it('se puede recorrer el flujo desactivado y las relaciones vacías', () => {
    const element = {} as Element
    const present = new Set<string>([TOUR_SELECTORS.editTabFlow, TOUR_SELECTORS.editFlowSetup, TOUR_SELECTORS.editFlowSave])
    const root = { querySelector: (selector: string) => present.has(selector) ? element : null }
    expect(visibleTourSteps(onboardingTours['editar-flujo'], root, () => true).map(step => step.selector))
      .toEqual([...present])
    for (const step of onboardingTours['editar-flujo'].steps) if (!present.has(step.selector!)) expect(step.optional).toBe(true)
    expect(onboardingTours['editar-relaciones'].steps.at(-1)?.optional).toBe(true)
    expect(onboardingTours['editar-listado'].steps.find(step => step.selector === TOUR_SELECTORS.editListTable)?.optional).toBe(true)
    expect(onboardingTours['editar-menu'].steps.slice(2).every(step => step.optional)).toBe(true)
  })

  it('reanuda en el módulo y la pestaña guardados, conservando query y hash', () => {
    const originPath = '/modulos/original/editar?tab=flow&source=panel#config'
    const id = 'editar-flujo'
    const progress = { id, index: 3, branch: null, originPath }
    expect(readTourProgress({ getItem: () => JSON.stringify(progress) }, 'key', id)).toEqual(progress)
    for (const step of onboardingTours[id].steps) expect(tourStepDestination(id, 3, step, originPath)).toBe(originPath)
    for (const oldId of ['bienvenida', 'primer-modulo', 'crear-modulo-manual'] as TourId[]) expect(isModuleEditTour(oldId)).toBe(false)
  })

  it('ofrece la acción del mensaje solo en su URL y el recorrido contextual en el panel', () => {
    const panel = template('components/ChattitoPanel.vue')
    expect(panel).toContain("message.action?.kind === 'start-tour'")
    expect(panel).toContain('route.fullPath === message.action.originPath')
    expect(panel).toContain('recommendedTour === message.action.tourId')
    expect(panel).toContain('canLaunchTour(message.action.tourId)')
    expect(panel).toContain('@click="startTour(message.action.tourId)">Ver recorrido')
    expect(panel).toContain('@click="startTour(recommendedTour)"')
  })
})
