export const WORKFLOW_MAP_WIDTH = 540
export const WORKFLOW_MAP_HEIGHT = 400
export const WORKFLOW_NODE_WIDTH = 112
export const WORKFLOW_NODE_HEIGHT = 80

export interface WorkflowMapNode {
  value: string
  x: number
  y: number
  width: number
  height: number
}

export type WorkflowMapPositions = Record<string, { x: number; y: number }>

export function clampWorkflowMapPosition(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(WORKFLOW_MAP_WIDTH - WORKFLOW_NODE_WIDTH, Math.max(0, x)),
    y: Math.min(WORKFLOW_MAP_HEIGHT - WORKFLOW_NODE_HEIGHT, Math.max(0, y))
  }
}

export function applyWorkflowMapPositions(nodes: WorkflowMapNode[], positions?: WorkflowMapPositions): WorkflowMapNode[] {
  return nodes.map(node => {
    const position = positions?.[node.value]
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return node
    return { ...node, ...clampWorkflowMapPosition(position.x, position.y) }
  })
}

export function canConnectWorkflowStates(from: string, to: string, transitions: Array<{ from: string; to: string }>): boolean {
  return Boolean(from && to && from !== to && !transitions.some(item => item.from === from && item.to === to))
}

export function layoutWorkflowMap(values: string[]): WorkflowMapNode[] {
  if (values.length === 0) return []

  const columns = values.length <= 4 ? values.length : values.length <= 9 ? 3 : 4
  const rows = Math.ceil(values.length / columns)
  const gapX = 24
  const gapY = 32
  const totalHeight = rows * WORKFLOW_NODE_HEIGHT + (rows - 1) * gapY
  const firstY = (WORKFLOW_MAP_HEIGHT - totalHeight) / 2

  return values.map((value, index) => {
    const row = Math.floor(index / columns)
    const column = index % columns
    const countInRow = Math.min(columns, values.length - row * columns)
    const rowWidth = countInRow * WORKFLOW_NODE_WIDTH + (countInRow - 1) * gapX
    const firstX = (WORKFLOW_MAP_WIDTH - rowWidth) / 2
    return { value, x: firstX + column * (WORKFLOW_NODE_WIDTH + gapX), y: firstY + row * (WORKFLOW_NODE_HEIGHT + gapY), width: WORKFLOW_NODE_WIDTH, height: WORKFLOW_NODE_HEIGHT }
  })
}

export function workflowMapEdgePath(from: WorkflowMapNode, to: WorkflowMapNode): string {
  const sameRow = Math.abs(from.y - to.y) < 1
  if (sameRow) {
    const rightward = from.x < to.x
    const startX = rightward ? from.x + from.width : from.x
    const endX = rightward ? to.x : to.x + to.width
    const y = from.y + from.height / 2
    const midX = (startX + endX) / 2
    return `M ${startX} ${y} C ${midX} ${y}, ${midX} ${y}, ${endX} ${y}`
  }

  const downward = from.y < to.y
  const startX = from.x + from.width / 2
  const endX = to.x + to.width / 2
  const startY = downward ? from.y + from.height : from.y
  const endY = downward ? to.y : to.y + to.height
  const midY = (startY + endY) / 2
  return `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`
}
