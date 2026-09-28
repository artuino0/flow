import { describe, expect, it } from 'vitest'
import type { Blueprint } from '~/server/utils/blueprint/schema'
import { buildDesignerGraph, SYSTEM_USERS_ID } from '~/utils/designerGraph'
import { designerAppearanceOrder, designerEdgeFlowDirection, designerMotionTone, designerProposalChanges, designerPulseEdges } from '~/utils/designerMotion'

const blank: Blueprint = { version: 1, summary: '', modules: [], associations: [] }
const proposal: Blueprint = { ...blank, modules: [
  { ref: 'partidas', slug: 'partidas', name: 'Partidas', action: 'create', kind: 'hecho', fields: [] },
  { ref: 'pedidos', slug: 'pedidos', name: 'Pedidos', action: 'create', kind: 'hecho', fields: [{ name: 'responsable', label: 'Responsable', dataType: 'user' }], lines: [{ childRef: 'partidas', relationField: 'pedido' }] },
  { ref: 'productos', slug: 'productos', name: 'Productos', action: 'create', kind: 'dimension', fields: [] }
] }
const graph = buildDesignerGraph(blank, proposal, null)

describe('movimiento del diseñador', () => {
  it('ordena catálogos, encabezados y partidas aunque el plano llegue desordenado', () => {
    expect(designerAppearanceOrder(graph, ['partidas', 'pedidos', 'productos', SYSTEM_USERS_ID])).toEqual(['productos', 'pedidos', 'partidas', SYSTEM_USERS_ID])
  })

  it('clasifica el color por tipo y reserva gris para el sistema', () => {
    expect(graph.modules.map(module => [module.id, designerMotionTone(module)])).toEqual([
      ['partidas', 'module'], ['pedidos', 'module'], ['productos', 'catalog'], [SYSTEM_USERS_ID, 'system']
    ])
  })

  it('limita los pulsos a relaciones directas y respeta el sentido del flujo', () => {
    expect(designerPulseEdges(graph, 'pedidos', null)).toEqual(new Set(['line:pedidos:partidas:pedido', 'user:pedidos:responsable']))
    expect(designerEdgeFlowDirection(graph.edges.find(edge => edge.kind === 'lines')!)).toBe('forward')
    expect(designerEdgeFlowDirection(graph.edges.find(edge => edge.kind === 'user')!)).toBe('reverse')
    const crowded = { ...graph, edges: Array.from({ length: 41 }, (_, index) => ({ ...graph.edges[0]!, id: `edge-${index}` })) }
    expect(designerPulseEdges(crowded, null, null).size).toBe(0)
    expect(designerPulseEdges(crowded, 'pedidos', null).size).toBe(41)
  })

  it('en una actualización anima solo el nodo modificado, el campo agregado y la arista nueva', () => {
    const updated: Blueprint = { ...proposal, modules: proposal.modules.map(module => module.slug === 'pedidos'
      ? { ...module, fields: [...module.fields, { name: 'nota', label: 'Nota', dataType: 'text' }] }
      : module), associations: [{ name: 'Pedido producto', sourceRef: 'pedidos', targetRef: 'productos' }] }
    expect(designerProposalChanges(graph, buildDesignerGraph(blank, updated, null))).toEqual({
      nodeIds: ['pedidos'], edgeIds: ['association:Pedido producto'], fieldKeys: ['pedidos:nota']
    })
    expect(designerProposalChanges(graph, graph)).toEqual({ nodeIds: [], edgeIds: [], fieldKeys: [] })
  })
})
