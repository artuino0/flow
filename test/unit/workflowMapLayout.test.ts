import { describe, expect, it } from 'vitest'
import { applyWorkflowMapPositions, canConnectWorkflowStates, clampWorkflowMapPosition, layoutWorkflowMap, workflowMapEdgePath, WORKFLOW_MAP_HEIGHT, WORKFLOW_MAP_WIDTH } from '../../utils/workflowMapLayout'

describe('disposición del mapa de estados', () => {
  for (const count of Array.from({ length: 12 }, (_, index) => index + 1)) {
    it(`ubica ${count} estado(s) sin solapes y dentro de la caja`, () => {
      const nodes = layoutWorkflowMap(Array.from({ length: count }, (_, index) => `estado-${index}`))
      expect(nodes).toHaveLength(count)

      for (const [index, node] of nodes.entries()) {
        expect(node.x).toBeGreaterThanOrEqual(0)
        expect(node.y).toBeGreaterThanOrEqual(0)
        expect(node.x + node.width).toBeLessThanOrEqual(WORKFLOW_MAP_WIDTH)
        expect(node.y + node.height).toBeLessThanOrEqual(WORKFLOW_MAP_HEIGHT)
        expect(node.width / node.height).toBeGreaterThan(1)
        expect(node.width / node.height).toBeLessThan(2)

        for (const other of nodes.slice(index + 1)) {
          const separated = node.x + node.width <= other.x || other.x + other.width <= node.x || node.y + node.height <= other.y || other.y + other.height <= node.y
          expect(separated).toBe(true)
        }
      }

      if (count > 4) expect(new Set(nodes.map(node => node.y)).size).toBeGreaterThan(1)
      const usedWidth = Math.max(...nodes.map(node => node.x + node.width)) - Math.min(...nodes.map(node => node.x))
      const usedHeight = Math.max(...nodes.map(node => node.y + node.height)) - Math.min(...nodes.map(node => node.y))
      expect(usedWidth / usedHeight).toBeGreaterThanOrEqual(0.7)
      expect(usedWidth / usedHeight).toBeLessThanOrEqual(count === 4 ? 6.5 : 5)
    })
  }
})

describe('edición del mapa', () => {
  it('aplica posiciones manuales sobre el layout y recorta a la caja', () => {
    const automatic = layoutWorkflowMap(['uno', 'dos'])
    const manual = applyWorkflowMapPositions(automatic, { uno: { x: -20, y: 999 }, dos: { x: 30, y: 40 }, eliminado: { x: 4, y: 4 } })
    expect(manual[0]).toMatchObject({ x: 0, y: 320 })
    expect(manual[1]).toMatchObject({ x: 30, y: 40 })
    expect(manual).toHaveLength(2)
    expect(clampWorkflowMapPosition(999, -9)).toEqual({ x: 428, y: 0 })
  })

  it('recalcula el trazo con nodos movidos', () => {
    const nodes = layoutWorkflowMap(['uno', 'dos'])
    const original = workflowMapEdgePath(nodes[0]!, nodes[1]!)
    const moved = applyWorkflowMapPositions(nodes, { dos: { x: 20, y: 300 } })
    expect(workflowMapEdgePath(moved[0]!, moved[1]!)).not.toBe(original)
    expect(workflowMapEdgePath(moved[0]!, moved[1]!)).toContain('300')
  })

  it('impide conexiones consigo mismo y duplicadas', () => {
    const transitions = [{ from: 'uno', to: 'dos' }]
    expect(canConnectWorkflowStates('uno', 'uno', transitions)).toBe(false)
    expect(canConnectWorkflowStates('uno', 'dos', transitions)).toBe(false)
    expect(canConnectWorkflowStates('dos', 'uno', transitions)).toBe(true)
  })

  it('admite layout ausente e ignora posiciones de estados eliminados', () => {
    const nodes = layoutWorkflowMap(['uno'])
    expect(applyWorkflowMapPositions(nodes)).toEqual(nodes)
    expect(applyWorkflowMapPositions(nodes, { eliminado: { x: 10, y: 10 } })).toEqual(nodes)
  })
})
