import { describe, expect, it } from 'vitest'
import { MODULE_ICON_KEY_SET } from '../../server/utils/moduleIcons'
import { normalizeDesignerIcons } from '../../server/utils/moduleDesigner/normalizeIcons'
import { DESIGNER_ICON_SUGGESTIONS } from '../../utils/designerIconSuggestions'

const empty = { modules: [] }
const proposal = (icon?: unknown) => ({ version: 1, summary: 'Prueba', associations: [], modules: [{ ref: 'pedidos', action: 'create', kind: 'hecho', name: 'Pedidos', slug: 'pedidos', fields: [], ...(icon === undefined ? {} : { icon }) }] })
const moduleIcon = (input: unknown) => (normalizeDesignerIcons(input, empty).blueprint as { modules: Array<{ icon: string }> }).modules[0]!.icon

describe('iconos propuestos por el diseñador', () => {
  it('la lista curada contiene 80 claves únicas del catálogo real', () => {
    expect(DESIGNER_ICON_SUGGESTIONS).toHaveLength(80)
    expect(new Set(DESIGNER_ICON_SUGGESTIONS).size).toBe(80)
    expect(DESIGNER_ICON_SUGGESTIONS.filter(icon => !MODULE_ICON_KEY_SET.has(icon))).toEqual([])
  })

  it('conserva un icono válido', () => {
    const input = proposal('ShoppingCart')
    expect(normalizeDesignerIcons(input, empty)).toEqual({ blueprint: input, warnings: [] })
  })

  it('corrige mayúsculas y guiones sin cambiar el significado', () => {
    expect(moduleIcon(proposal('shopping-cart'))).toBe('ShoppingCart')
    expect(moduleIcon(proposal('TRUCK'))).toBe('Truck')
  })

  it('usa Box con advertencia para un icono inexistente o ausente', () => {
    for (const input of [proposal('IconoQueNoExiste'), proposal()]) {
      const result = normalizeDesignerIcons(input, empty)
      expect((result.blueprint as ReturnType<typeof proposal>).modules[0]!.icon).toBe('Box')
      expect(result.warnings.join(' ')).toContain('Usé un icono genérico para Pedidos')
    }
  })

  it('conserva el icono del módulo existente aunque la IA intente cambiarlo', () => {
    const current = { modules: [{ ref: 'clientes', action: 'extend' as const, kind: 'dimension' as const, name: 'Clientes', slug: 'clientes', icon: 'Users', fields: [] }] }
    const input = { modules: [{ action: 'extend', slug: 'clientes', icon: 'IconoQueNoExiste' }] }
    const result = normalizeDesignerIcons(input, current)
    expect((result.blueprint as typeof input).modules[0]!.icon).toBe('Users')
    expect(result.warnings.join(' ')).toContain('Conservé el icono existente de Clientes')
  })
})
