// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { readFileSync } from 'node:fs'
import { compileVueComponent } from '../helpers/vueComponent'
import baseline from '../fixtures/themeBaseline166.json'
import { darkTokens, lightTokens } from '../../utils/themeTokens'
import { auditThemeSource, migratedThemeFiles } from '../../scripts/auditThemeColors'
import { contrast, compositeContrast, isResizeContrast, themeContrasts } from '../helpers/themeContrast'

const apps: App[] = []
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks() })

describe('regresión BUG-166', () => {
  it('conserva todos los claros y solo cambia los oscuros designer autorizados', () => {
    const changed = ['designer-selected-edge', 'designer-new-arrow', 'designer-existing-edge', 'designer-edge', 'designer-label', 'designer-minimap-existing', 'designer-minimap-mask', 'designer-handle', 'designer-edge-updating']
    for (const [name, value] of Object.entries(baseline.light)) expect(lightTokens[name as keyof typeof lightTokens], name).toBe(value)
    const actual = Object.entries(baseline.dark).filter(([name, value]) => darkTokens[name as keyof typeof darkTokens] !== value).map(([name]) => name)
    expect(actual.sort()).toEqual(changed.sort())
    for (const name of ['designer-edge', 'designer-existing-edge', 'designer-selected-edge', 'designer-new-arrow', 'designer-handle', 'designer-edge-updating', 'designer-label'] as const) {
      expect(contrast(darkTokens[name], darkTokens.bg), name).toBeGreaterThan(contrast(baseline.dark[name], baseline.dark.bg))
    }
    expect(compositeContrast(darkTokens['designer-label'], darkTokens['designer-label-bg'], darkTokens.bg, .92)).toBeGreaterThan(4.5)
  })

  it('cubre el divisor compartido, su claro exacto y el foco/marca oscuros sin ocultar déficits claros', () => {
    const source = readFileSync('components/PanelResizeHandle.vue', 'utf8')
    expect(migratedThemeFiles).toContain('components/PanelResizeHandle.vue')
    expect(auditThemeSource('components/PanelResizeHandle.vue', source)).toEqual([])
    for (const [name, hex] of Object.entries({ 'resize-bg': '#EEF2F5', 'resize-hover': '#D6EDF1', 'resize-mark': '#ADC0CF', 'resize-border': '#D8E1E8', blue: '#0091AE' })) {
      expect(lightTokens[name as keyof typeof lightTokens]).toBe(hex)
      expect(source).toContain(`rgb(var(--brand-${name}))`)
    }
    const pairs = themeContrasts().filter(isResizeContrast)
    expect(pairs.filter(pair => pair.ratio < pair.minimum).map(pair => [pair.id, Number(pair.ratio.toFixed(3))])).toEqual([
      ['light:resize-mark/resize-hover', 1.537], ['light:resize-mark/resize-bg', 1.663]
    ])
    for (const pair of pairs.filter(pair => pair.theme === 'dark')) expect(pair.ratio, pair.id).toBeGreaterThanOrEqual(3)
    const page = readFileSync('pages/disenador.vue', 'utf8')
    expect(page.match(/\.designer-handle\s*\{[^}]*\}/g)).toEqual(['.designer-handle { display: none; }'])
    expect(readFileSync('pages/sites/[siteId]/pages/[pageId].vue', 'utf8')).not.toContain('darkReady: true')
  })

  it('reduce brillo del minimapa y separa sus secciones de los nodos sin cambiar el claro', () => {
    expect(contrast(darkTokens['designer-minimap-bg'], '#000000')).toBeLessThan(contrast(baseline.dark.surface, '#000000'))
    expect(contrast(darkTokens['designer-minimap-existing'], '#000000')).toBeLessThan(contrast(baseline.dark['designer-minimap-existing'], '#000000'))
    expect(lightTokens['designer-minimap-bg']).toBe(baseline.light.surface)
    expect(lightTokens['designer-minimap-new']).toBe(baseline.light['designer-new'])
    expect(lightTokens['designer-minimap-system']).toBe(baseline.light['designer-system-muted'])
    expect(lightTokens['designer-minimap-section']).toBe(baseline.light['designer-minimap-existing'])
    for (const name of ['designer-minimap-existing', 'designer-minimap-new', 'designer-minimap-system'] as const) {
      for (const bg of ['designer-minimap-bg', 'designer-minimap-section'] as const) expect(contrast(darkTokens[name], darkTokens[bg]), `${name}/${bg}`).toBeGreaterThanOrEqual(3)
    }
    // Máscara real al 60%, visible respecto al fondo (sin fingir un mínimo WCAG de texto).
    expect(compositeContrast(darkTokens['designer-minimap-bg'], darkTokens['designer-minimap-mask'], darkTokens['designer-minimap-bg'], .6)).toBeGreaterThan(1.5)
  })

  it.each([1, -1] as const)('mantiene teclado, límites, arrastre, commit y limpieza del divisor (dirección %s)', async direction => {
    const update = vi.fn(), commit = vi.fn()
    const component = compileVueComponent('components/PanelResizeHandle.vue')
    const host = document.createElement('div'); document.body.append(host)
    const app = createApp(component, { modelValue: 360, min: 280, max: 480, defaultValue: 320, label: 'Redimensionar panel', direction, 'onUpdate:modelValue': update, onCommit: commit })
    apps.push(app); app.mount(host)
    const handle = host.querySelector<HTMLElement>('[role="separator"]')!
    expect(handle.getAttribute('tabindex')).toBe('0')
    expect(handle.getAttribute('aria-valuenow')).toBe('360')
    handle.focus(); expect(document.activeElement).toBe(handle)
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(update).toHaveBeenLastCalledWith(360 + 8 * direction)
    expect(commit).toHaveBeenCalledTimes(1)
    const pointer = (target: EventTarget, type: string, clientX: number) => target.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true, cancelable: true }))
    pointer(handle, 'pointerdown', 100)
    expect(document.body.classList.contains('panel-resizing')).toBe(true)
    pointer(window, 'pointermove', 1000)
    expect(update).toHaveBeenLastCalledWith(direction === 1 ? 480 : 280)
    pointer(window, 'pointerup', 1000)
    expect(commit).toHaveBeenCalledTimes(2)
    expect(document.body.classList.contains('panel-resizing')).toBe(false)
    handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(update).toHaveBeenLastCalledWith(320)
    expect(commit).toHaveBeenCalledTimes(3)
    pointer(handle, 'pointerdown', 100)
    app.unmount(); apps.pop(); await nextTick()
    expect(document.body.classList.contains('panel-resizing')).toBe(false)
    const before = update.mock.calls.length
    pointer(window, 'pointermove', 130)
    expect(update).toHaveBeenCalledTimes(before)
  })
})
