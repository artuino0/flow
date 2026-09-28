import { describe, expect, it } from 'vitest'
import type { Blueprint } from '~/server/utils/blueprint/schema'
import { buildDesignerGraph, filterDesignerRelations, focusDesignerEdge, focusDesignerGraph, layoutDesignerGraph, visibleDesignerGraph, type DesignerDiff } from '~/utils/designerGraph'

const current: Blueprint = { version: 1, summary: 'Actual', associations: [], modules: [
  { ref: 'clientes', action: 'extend', kind: 'hecho', name: 'Clientes', slug: 'clientes', snapshot: true, fields: [{ name: 'nombre', label: 'Nombre', dataType: 'text', required: true }] },
  { ref: 'vehiculos', action: 'extend', kind: 'hecho', name: 'Vehículos', slug: 'vehiculos', snapshot: true, fields: [{ name: 'cliente', label: 'Cliente', dataType: 'relation', validationRules: { relationEntity: 'clientes' } }] }
] }
const proposal: Blueprint = { ...current, summary: 'Taller', modules: [
  current.modules[0]!,
  { ...current.modules[1]!, fields: [...current.modules[1]!.fields, { name: 'placas', label: 'Placas', dataType: 'text' }] },
  { ref: 'ordenes', action: 'create', kind: 'hecho', name: 'Órdenes', slug: 'ordenes', icon: 'ShoppingCart', fields: [{ name: 'vehiculo', label: 'Vehículo', dataType: 'relation', validationRules: { relationEntity: 'vehiculos' } }] },
  { ref: 'partidas', action: 'create', kind: 'hecho', name: 'Partidas', slug: 'partidas', fields: [{ name: 'orden', label: 'Orden', dataType: 'relation', validationRules: { relationEntity: 'ordenes' } }] }
] }
proposal.modules[2]!.lines = [{ childRef: 'partidas', relationField: 'orden', totals: ['importe'] }]
const diff: DesignerDiff = { newModules: [{ slug: 'ordenes', name: 'Órdenes' }, { slug: 'partidas', name: 'Partidas' }], newCatalogs: [], extendedModules: [{ slug: 'vehiculos', fields: ['placas'] }], relations: [{ source: 'ordenes', field: 'vehiculo', target: 'vehiculos' }], associations: [], states: [], merges: [], plan: { code: 'starter', name: 'Starter', used: 2, added: 2, after: 4, limit: 5, allowed: true } }
const navigation = { layout: { groups: [{ id: '71251b14-dd0b-4ecd-877a-b14316e16d39', name: 'Ventas', icon: null, parentId: null, entityIds: ['a'] }] }, entities: [{ id: 'a', slug: 'clientes' }] }

describe('grafo del diseñador', () => {
  const graph = buildDesignerGraph(current, proposal, diff, navigation)
  it('distingue módulos existentes, nuevos y campos agregados', () => {
    expect(graph.modules.find(item => item.id === 'clientes')?.state).toBe('existing')
    expect(graph.modules.find(item => item.id === 'ordenes')?.state).toBe('new')
    expect(graph.modules.find(item => item.id === 'ordenes')?.icon).toBe('ShoppingCart')
    expect(graph.modules.find(item => item.id === 'vehiculos')?.fields.find(field => field.name === 'placas')?.state).toBe('added')
    expect(graph.modules.find(item => item.id === 'vehiculos')?.fields.find(field => field.name === 'cliente')?.state).toBe('existing')
  })
  it('agrupa por sección, filtra y enfoca relaciones directas', () => {
    expect(graph.modules.find(item => item.id === 'clientes')?.section).toBe('Ventas')
    expect(graph.modules.find(item => item.id === 'ordenes')?.section).toBe('Propuesta')
    expect(visibleDesignerGraph(graph, 'órdenes', '').modules.map(item => item.id)).toEqual(['ordenes'])
    expect(visibleDesignerGraph(graph, '', 'Ventas').modules.map(item => item.id)).toEqual(['clientes'])
    expect(focusDesignerGraph(graph, 'ordenes').active).toEqual(new Set(['ordenes', 'vehiculos', 'partidas']))
  })
  it('crea cardinalidades y una sola arista gruesa para partidas', () => {
    expect(graph.edges.find(edge => edge.kind === 'lines')).toMatchObject({ source: 'ordenes', target: 'partidas', state: 'new' })
    expect(graph.edges.filter(edge => edge.source === 'partidas' && edge.target === 'ordenes')).toHaveLength(0)
    expect(graph.edges.find(edge => edge.source === 'vehiculos')?.label).toContain('N · Cliente · 1')
  })
  it('conserva posiciones guardadas', () => {
    const layout = layoutDesignerGraph(graph, { clientes: { x: 400, y: 120 } })
    expect(layout.positions.clientes).toEqual({ x: 400, y: 120 })
    expect(layout.positions.ordenes).toBeDefined()
  })

  it('resalta únicamente los extremos de una arista y limpia el resaltado', () => {
    const highlighted = focusDesignerEdge(graph, 'line:ordenes:partidas:orden')
    expect(highlighted.active).toEqual(new Set(['ordenes', 'partidas']))
    expect(highlighted.edges).toEqual(new Set(['line:ordenes:partidas:orden']))
    expect(focusDesignerEdge(graph, null).active.size).toBe(graph.modules.length)
    expect(focusDesignerEdge(graph, null).edges.size).toBe(graph.edges.length)
  })

  it('filtra vecinos directos en ambas direcciones e incluye asociaciones M:N', () => {
    const withCatalogs: Blueprint = { ...proposal, modules: [...proposal.modules,
      { ref: 'categorias', action: 'create', kind: 'dimension', name: 'Categorías', slug: 'categorias', fields: [] },
      { ref: 'etiquetas', action: 'create', kind: 'dimension', name: 'Etiquetas', slug: 'etiquetas', fields: [{ name: 'orden', label: 'Orden', dataType: 'relation', validationRules: { relationEntity: 'ordenes' } }] }
    ], associations: [{ name: 'orden-categoria', sourceRef: 'categorias', targetRef: 'ordenes' }] }
    const relatedGraph = buildDesignerGraph(current, withCatalogs, diff)
    const ids = (filter: 'all' | 'catalogs' | 'modules') => new Set(filterDesignerRelations(relatedGraph, 'ordenes', filter).modules.map(module => module.id))
    expect(ids('all')).toEqual(new Set(['ordenes', 'vehiculos', 'partidas', 'categorias', 'etiquetas']))
    expect(ids('catalogs')).toEqual(new Set(['ordenes', 'categorias', 'etiquetas']))
    expect(ids('modules')).toEqual(new Set(['ordenes', 'vehiculos', 'partidas']))
    const catalogs = filterDesignerRelations(relatedGraph, 'ordenes', 'catalogs')
    expect(catalogs.edges.map(edge => edge.id)).toEqual(['relation:etiquetas:orden:ordenes', 'association:orden-categoria'])
    expect(catalogs.modules.some(module => module.id === 'clientes')).toBe(false)
    expect(filterDesignerRelations(relatedGraph, 'ordenes', 'none')).toBe(relatedGraph)
    expect(filterDesignerRelations(relatedGraph, null, 'all')).toBe(relatedGraph)
  })
})
