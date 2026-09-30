import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, reactive, ref } from 'vue'
import { parse } from '@vue/compiler-sfc'
import type { ElementNode, TemplateChildNode } from '@vue/compiler-core'
import { useChattitoContext } from '../../composables/useChattitoContext'
import { resolveChattitoContext, SETTINGS_SECTIONS } from '../../utils/chattitoContext'
import { chattitoHelpId, chattitoHelpStorageKey, helpForContext } from '../../utils/chattitoHelp'
import { allowsTourTargetClick, canRunTour, contextualTourMatchesRoute, onboardingTours, SETTINGS_TOURS, TOUR_SELECTORS, tourNeedsAdministration, tourStepDestination } from '../../utils/onboardingTours'

function elements(children: TemplateChildNode[]): ElementNode[] {
  return children.flatMap(node => node.type === 1 ? [node, ...elements(node.children)] : [])
}

describe('contexto y recorrido de Plan y consumo', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(SETTINGS_SECTIONS)('reconoce la sección %s y solo ofrece ayuda para plan', section => {
    const context = resolveChattitoContext({ path: '/ajustes', params: {}, query: { section } }, true)
    expect(context).toEqual({ page: 'settings', section })
    expect(chattitoHelpId(context)).toBe(section === 'plan' ? 'settings:plan' : null)
  })

  it.each(['desconocida', ['plan'], 3])('rechaza la sección no válida %j', section => {
    expect(resolveChattitoContext({ path: '/ajustes', params: {}, query: { section } })).toEqual({ page: 'unknown' })
  })

  it('usa la sección por defecto según el rol y reacciona a la navegación interna', () => {
    const route = reactive({ path: '/ajustes', params: {}, query: {} as Record<string, unknown> })
    const admin = ref(true)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useIsAdmin', () => ({ data: admin }))
    const { context, recommendedTour } = useChattitoContext()
    expect(context.value).toEqual({ page: 'settings', section: 'organizacion' })
    admin.value = false
    expect(context.value).toEqual({ page: 'settings', section: 'perfil' })
    route.query.section = 'plan'
    expect(context.value).toEqual({ page: 'settings', section: 'plan' })
    expect(recommendedTour.value).toBe('ajustes-plan')
    route.query.section = 'inexistente'
    expect(recommendedTour.value).toBeNull()
  })

  it('tiene siete pasos informativos con acceso administrativo y destino original', () => {
    const tour = onboardingTours[SETTINGS_TOURS.plan]
    expect(tour.steps).toHaveLength(7)
    expect(tour.requires).toEqual(['settings.modules'])
    expect(canRunTour(tour, { isAdmin: false, designerAvailable: true })).toBe(false)
    expect(canRunTour(tour, { isAdmin: true, designerAvailable: false })).toBe(true)
    expect(tourNeedsAdministration(tour.id, 'administration')).toBe(false)
    expect(contextualTourMatchesRoute(tour.id, '/ajustes', { section: 'plan' })).toBe(true)
    expect(contextualTourMatchesRoute(tour.id, '/ajustes', { section: ['plan'] })).toBe(false)
    expect(tour.steps[0]!.optional).toBeUndefined()
    for (const [index, step] of tour.steps.entries()) {
      expect(Object.values(TOUR_SELECTORS)).toContain(step.selector)
      expect(allowsTourTargetClick(step)).toBe(false)
      for (const key of ['waitForClick', 'completeWhen', 'interactive', 'action', 'path'] as const) expect(step[key]).toBeUndefined()
      if (index) expect(step.optional).toBe(true)
      expect(tourStepDestination(tour.id, index, step, '/ajustes?section=plan#uso')).toBe('/ajustes?section=plan#uso')
    }
    const help = helpForContext({ page: 'settings', section: 'plan' })!
    expect(help.tourId).toBe(tour.id)
    expect(help.bullets!.length).toBeLessThanOrEqual(4)
    expect(chattitoHelpStorageKey('t', 'u', 'settings:plan', 'seen')).not.toBe(chattitoHelpStorageKey('t', 'u', 'module-edit:info', 'seen'))
  })

  it('todos los anclajes pertenecen a templates y el botón se integra junto al título', () => {
    const page = readFileSync('pages/ajustes/index.vue', 'utf8')
    const billing = readFileSync('components/SettingsBillingSummary.vue', 'utf8')
    const templates = [page, billing].map(source => parse(source).descriptor.template!.content).join('\n')
    for (const step of onboardingTours['ajustes-plan'].steps) {
      expect(templates).toContain(step.selector!.slice(1, -1))
    }
    expect(page).toContain('<template v-if="section === \'plan\'" #title-help><ModuleTourHelpButton help-id="settings:plan" /></template>')
    const header = parse(readFileSync('components/ListPageHeader.vue', 'utf8')).descriptor.template!
    const titleRow = elements(header.ast!.children).find(node => node.children.some(child => child.type === 1 && child.tag === 'h1'))!
    expect(titleRow).toBeDefined()
    expect(titleRow.children.some(child => child.type === 1 && child.tag === 'slot' && child.props.some(prop => prop.type === 6 && prop.name === 'name' && prop.value?.content === 'title-help'))).toBe(true)
  })
})
