import type { DiagramEdge, DiagramGraph, DiagramModule } from './designerGraph'

export type DesignerTone = 'module' | 'catalog' | 'system'

export interface DesignerProposalChanges { nodeIds: string[]; edgeIds: string[]; fieldKeys: string[] }

/** Compara con la versión visible antes de recibir la respuesta de IA. */
export function designerProposalChanges(previous: DiagramGraph, next: DiagramGraph): DesignerProposalChanges {
  const oldModules = new Map(previous.modules.map(module => [module.id, module]))
  const oldEdges = new Set(previous.edges.map(edge => edge.id))
  const nodeIds = next.modules.filter(module => {
    const old = oldModules.get(module.id)
    return !old || JSON.stringify(old.module) !== JSON.stringify(module.module)
  }).map(module => module.id)
  const fieldKeys = next.modules.flatMap(module => {
    const old = oldModules.get(module.id)
    if (!old) return []
    const oldFields = new Map(old.fields.map(field => [field.name, field]))
    return module.fields.filter(field => JSON.stringify(oldFields.get(field.name)) !== JSON.stringify(field)).map(field => `${module.id}:${field.name}`)
  })
  return { nodeIds, edgeIds: next.edges.filter(edge => !oldEdges.has(edge.id)).map(edge => edge.id), fieldKeys }
}

export function designerMotionTone(module: DiagramModule): DesignerTone {
  return module.system ? 'system' : module.module.kind === 'dimension' ? 'catalog' : 'module'
}

/** Catálogos primero; dentro de los hechos, el encabezado precede a sus partidas. */
export function designerAppearanceOrder(graph: DiagramGraph, changedIds: readonly string[]): string[] {
  const changed = new Set(changedIds)
  const modules = graph.modules.filter(module => changed.has(module.id))
  const original = new Map(modules.map((module, index) => [module.id, index]))
  const byId = new Map(modules.map(module => [module.id, module]))
  const parents = new Map(modules.map(module => [module.id, new Set<string>()]))
  for (const edge of graph.edges) if (edge.kind === 'lines' && parents.has(edge.target) && parents.has(edge.source)) parents.get(edge.target)!.add(edge.source)
  const remaining = new Set(modules.map(module => module.id))
  const ordered: string[] = []
  const priority = (id: string) => {
    const tone = designerMotionTone(byId.get(id)!)
    return tone === 'catalog' ? 0 : tone === 'module' ? 1 : 2
  }
  while (remaining.size) {
    const ready = [...remaining].filter(id => [...(parents.get(id) ?? [])].every(parent => !remaining.has(parent)))
    const candidates = ready.length ? ready : [...remaining]
    candidates.sort((a, b) => priority(a) - priority(b) || (original.get(a) ?? 0) - (original.get(b) ?? 0))
    const next = candidates[0]!
    remaining.delete(next)
    ordered.push(next)
  }
  return ordered
}

/** Las relaciones apuntan hacia el catálogo; el pulso recorre esa ruta al revés. */
export function designerEdgeFlowDirection(edge: DiagramEdge): 'forward' | 'reverse' {
  return edge.kind === 'relation' || edge.kind === 'user' ? 'reverse' : 'forward'
}

export function designerPulseEdges(graph: DiagramGraph, selectedId: string | null, selectedEdgeId: string | null): Set<string> {
  if (selectedEdgeId) return new Set([selectedEdgeId])
  if (selectedId) return new Set(graph.edges.filter(edge => edge.source === selectedId || edge.target === selectedId).map(edge => edge.id))
  return graph.edges.length > 40 ? new Set() : new Set(graph.edges.map(edge => edge.id))
}
