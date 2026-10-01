import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse, compileScript } from '@vue/compiler-sfc'
import { detailConcepts, resourcePercent, sidebarResource, usageActions, usageMessages, usageState, usageText } from '../../utils/sidebarPlanUsage'
import type { PlanUsageEntry } from '../../utils/planLimit'

const storage = (percent: number | null, limit: number | null = 10 * 1024 ** 3): PlanUsageEntry => ({ concept: 'storageBytes', label: 'Almacenamiento', used: 4.2 * 1024 ** 3, limit, percent })

describe('consumo del menú lateral ERD-136', () => {
  it.each([[0, 'normal'], [79.9, 'normal'], [80, 'warning'], [89.9, 'warning'], [90, 'critical'], [99.9, 'critical'], [100, 'limit'], [140, 'limit']] as const)('el porcentaje %s produce %s', (percent, state) => {
    expect(usageState(storage(percent))).toBe(state)
    expect(usageMessages[state]).toBeTruthy()
    expect(usageActions[state]).toBeTruthy()
  })
  it('los recursos ilimitados no tienen barra ni estado de alarma', () => {
    expect(usageState(storage(100, null))).toBe('normal')
    expect(resourcePercent(storage(100, null))).toBeNull()
    expect(usageText(storage(null, null))).toBe('4.2 GB usados · Ilimitado')
    expect(usageState(null)).toBe('normal')
    expect(resourcePercent(storage(null))).toBeNull()
  })
  it('respeta los datos para el texto y limita únicamente la barra', () => {
    expect(usageText(storage(42))).toBe('4.2 GB de 10 GB usados')
    expect(resourcePercent(storage(140))).toBe(100)
    expect(resourcePercent(storage(-3))).toBe(0)
    expect(usageState(storage(100, 0))).toBe('limit')
    expect(usageText({ concept: 'users', label: 'Usuarios', used: 7, limit: 10, percent: 70 })).toBe('7 de 10 usados')
  })
  it('elige almacenamiento aunque otros conceptos tengan un consumo mayor', () => {
    const users: PlanUsageEntry = { concept: 'users', label: 'Usuarios', used: 10, limit: 10, percent: 100 }
    const item = storage(42)
    expect(sidebarResource([users, item])).toBe(item)
    expect(sidebarResource([users])).toBeNull()
    expect(detailConcepts).toEqual(['storageBytes', 'executions', 'users', 'sites', 'emails', 'stamps'])
  })
  it('monta las dos variantes al fondo y conserva el scroll de la navegación', () => {
    const nav = readFileSync('components/AppNav.vue', 'utf8')
    const component = readFileSync('components/SidebarPlanUsage.vue', 'utf8')
    expect(nav).toContain('<SidebarPlanUsage :compact="compact" />')
    expect(nav.indexOf('<SidebarPlanUsage')).toBeGreaterThan(nav.indexOf('</AppNavTooltip>'))
    expect(nav).toContain('min-h-0 flex-1 overflow-y-auto overflow-x-hidden')
    expect(component).toContain('class="usage-collapsed"')
    expect(component).toContain('class="usage-expanded"')
    expect(component).toContain(':aria-hidden="!compact" :inert="!compact"')
    expect(component).toContain(':aria-hidden="compact" :inert="compact"')
    expect(component).toContain('isAdmin.value === true && !permissionsPending.value')
    expect(component).toContain('snapshot.value?.scope === scope.value')
    expect(component).toContain('!usageError.value')
    expect(component).toContain('role="progressbar"')
    expect(component).toContain('role="dialog"')
    expect(component).toContain('aria-haspopup="dialog"')
    expect(component).toContain('focus-visible')
    expect(component).toContain('visibilitychange')
    expect(component).not.toContain('setInterval')
    expect(component).not.toContain('/api/billing/checkout')
    for (const file of ['components/SidebarPlanUsage.vue', 'components/AppNav.vue', 'components/AppNavTooltip.vue']) {
      const result = parse(readFileSync(file, 'utf8'), { filename: file })
      expect(result.errors).toEqual([])
      expect(() => compileScript(result.descriptor, { id: file })).not.toThrow()
    }
  })
  it('Plan y el menú usan las mismas fuentes y refrescan ambos datos', () => {
    const settings = readFileSync('components/SettingsBillingSummary.vue', 'utf8')
    const sidebar = readFileSync('components/SidebarPlanUsage.vue', 'utf8')
    for (const source of [settings, sidebar]) {
      expect(source).toContain('useDesignerPlanUsage(isAdmin)')
      expect(source).toContain('useBillingOverview(isAdmin)')
    }
    expect(settings).toContain('Promise.all([refreshOverview(), refreshPlanUsage()])')
    expect(settings).toContain('@click="refresh"')
  })
  it('conserva texto blanco y las medidas del botón naranja', () => {
    const component = readFileSync('components/SidebarPlanUsage.vue', 'utf8')
    const style = parse(component).descriptor.styles[0]!.content
    const button = style.match(/\.upgrade-button\s*\{([^}]+)\}/)![1]!
    expect(button).toContain('color:#fff')
    expect(button).not.toContain('brand.navy')
    expect(button).toContain("background:theme('colors.brand.orange')")
    expect(button).toContain('font-size:12px; font-weight:700')
    expect(button).toContain('border-radius:4px; padding:8px 10px')
    expect(style).toContain(".upgrade-button:hover { background:theme('colors.brand.orange-hover')")
  })
  it('anima entrada, espacio y variantes sin foco en la variante oculta y respeta movimiento reducido', () => {
    const component = readFileSync('components/SidebarPlanUsage.vue', 'utf8')
    expect(component).toContain('<Transition name="usage-enter" appear>')
    expect(component).toContain('class="usage-reveal" :class="{ \'is-visible\': visible && resource }"')
    expect(component).toContain(':aria-hidden="!visible" :inert="!visible"')
    expect(component).toContain("visibility: isAdmin !== true || permissionsPending || snapshot?.scope !== scope ? 'hidden' : undefined")
    expect(component).toContain('grid-template-rows:0fr')
    expect(component).toContain('.usage-reveal.is-visible { grid-template-rows:1fr')
    expect(component).toContain('.usage-variant-row.is-active { grid-template-rows:1fr')
    expect(component).toContain('opacity 240ms ease-out,transform 240ms ease-out')
    expect(component).toContain('width 300ms ease-out,background-color 300ms ease-out')
    expect(component).toContain('color 300ms ease-out')
    const reduced = component.slice(component.indexOf('@media (prefers-reduced-motion: reduce)'))
    for (const selector of ['.usage-reveal', '.usage-variant-row', '.usage-variant-clip', '.usage-enter-enter-active', '.usage-enter-leave-active', '.usage-track>span', '.status-dot', '.upgrade-button']) expect(reduced).toContain(selector)
    expect(reduced).toContain('transition:none')
    expect(reduced).toContain('transform:none')
    expect(reduced).toContain('opacity:1')
    expect(component).not.toContain('await useIsAdmin()')
    expect(component).not.toContain('await useDesignerPlanUsage(isAdmin)')
    expect(component).not.toContain('await useBillingOverview(isAdmin)')
  })
})
