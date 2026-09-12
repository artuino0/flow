import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { buildNavigation, navigationLayoutSchema, type NavigationLayout } from '../../utils/moduleNavigation'
const area = randomUUID(), process = randomUUID(), reception = randomUUID(), invoice = randomUUID(), catalog = randomUUID()
const layout: NavigationLayout = { groups: [
  { id: area, name: 'Producción', icon: null, parentId: null, entityIds: [] },
  { id: process, name: 'Empaque', icon: null, parentId: area, entityIds: [reception, invoice, catalog] }
] }
const entities = [
  { id: reception, slug: 'recepciones', name: 'Recepciones', icon: null, moduleKind: 'hecho', showInMenu: true },
  { id: invoice, slug: 'facturas', name: 'Facturas', icon: null, moduleKind: 'hecho', showInMenu: false },
  { id: catalog, slug: 'productores', name: 'Productores', icon: null, moduleKind: 'dimension', showInMenu: true }
]
describe('Navegación por área y permisos', () => {
  it('agrupa módulos sin mostrar catálogos ni módulos ocultos y sin mutar permisos', () => {
    const result = buildNavigation(layout, entities)
    expect(result.groups[0].children[0].modules.map(item => item.id)).toEqual([reception])
    expect(result.groups[0].children[0].catalogs).toEqual([])
    expect(entities).toHaveLength(3)
    expect(entities[1].showInMenu).toBe(false)
  })
  it('omite áreas y subprocesos sin entidades autorizadas', () => {
    expect(buildNavigation(layout, []).groups).toEqual([])
    expect(buildNavigation(layout, [entities[1]]).groups).toEqual([])
  })
  it('conserva módulos no asignados y tolera referencias a módulos eliminados', () => {
    expect(buildNavigation({ groups: [] }, entities).unassigned.map(item => item.id)).toEqual([reception])
    expect(buildNavigation(layout, [entities[2]]).groups).toEqual([])
  })
  it('conserva el orden configurado', () => {
    const reversed = { groups: [{ ...layout.groups[0], entityIds: [invoice, reception] }] }
    expect(buildNavigation(reversed, entities.map(item => ({ ...item, showInMenu: true }))).groups[0].modules.map(item => item.id)).toEqual([invoice, reception])
  })
  it('rechaza ciclos, tercer nivel y padres inexistentes', () => {
    for (const parentId of [process, randomUUID()]) {
      expect(navigationLayoutSchema.safeParse({ groups: [layout.groups[0], { ...layout.groups[1], parentId }] }).success).toBe(false)
    }
    expect(navigationLayoutSchema.safeParse({ groups: [...layout.groups, { id: randomUUID(), name: 'Tercero', icon: null, parentId: process, entityIds: [] }] }).success).toBe(false)
  })
  it('rechaza asignaciones duplicadas y nombres vacíos', () => {
    expect(navigationLayoutSchema.safeParse({ groups: [{ ...layout.groups[0], entityIds: [reception] }, layout.groups[1]] }).success).toBe(false)
    expect(navigationLayoutSchema.safeParse({ groups: [{ ...layout.groups[0], name: ' ' }] }).success).toBe(false)
    expect(navigationLayoutSchema.safeParse(layout).success).toBe(true)
  })
})
