import dagre from '@dagrejs/dagre'
import type { Blueprint, BlueprintField, BlueprintModule } from '~/server/utils/blueprint/schema'
import type { NavigationLayout } from '~/utils/moduleNavigation'

export interface DesignerDiff {
  newModules: Array<{ slug: string; name: string }>
  newCatalogs: Array<{ slug: string; name: string }>
  extendedModules: Array<{ slug: string; fields: string[] }>
  relations: Array<{ source: string; field: string; target: string }>
  associations: Array<{ name: string; sourceRef: string; targetRef: string }>
  states: Array<{ slug: string; states: string[] }>
  merges: Array<{ from: string; to: string; message: string; discardedFields: string[] }>
  plan: { code: string; name: string; used: number; added: number; after: number; limit: number | null; allowed: boolean }
}

export interface DiagramField extends BlueprintField { state: 'existing' | 'added' | 'new' }
export interface DiagramModule {
  id: string
  module: BlueprintModule
  icon: string | null
  state: 'existing' | 'extended' | 'new'
  fields: DiagramField[]
  section: string
  width: number
  height: number
  system?: true
}
export interface DiagramEdge {
  id: string
  source: string
  target: string
  label: string
  kind: 'relation' | 'lines' | 'association' | 'user'
  state: 'existing' | 'new'
}
export interface DiagramSection { id: string; title: string; moduleIds: string[] }
export interface DiagramGraph { modules: DiagramModule[]; edges: DiagramEdge[]; sections: DiagramSection[] }
export type DesignerRelationFilter = 'none' | 'all' | 'catalogs' | 'modules'
export const SYSTEM_USERS_ID = 'system:users'
export const SYSTEM_SECTION_ID = 'system:section'

export function designerNodeClickAction(graph: DiagramGraph, id: string): 'select' | 'info' | 'none' {
  if (id.startsWith('section:')) return 'none'
  const module = graph.modules.find(item => item.id === id)
  return module?.system ? 'info' : module ? 'select' : 'none'
}

export function designerFieldTypeLabel(field: BlueprintField) {
  if (field.validationRules?.calculation) return 'Calculado ƒx'
  return ({ text: 'Texto', number: 'Número', currency: 'Monto', boolean: 'Sí/No', date: 'Fecha', json: 'Datos', relation: `Relación → ${field.validationRules?.relationEntity ?? ''}`, user: 'Usuario', tabla: 'Tabla', select: 'Lista', multiselect: 'Lista múltiple', file: 'Archivo', incremental: 'Folio' } as Record<string, string>)[field.dataType] ?? field.dataType
}

export function buildDesignerGraph(current: Blueprint, blueprint: Blueprint, diff: DesignerDiff | null, navigation?: { layout: NavigationLayout; entities: Array<{ id: string; slug: string }> }): DiagramGraph {
  const existing = new Map(current.modules.map(module => [module.slug, module]))
  const newSlugs = new Set([...(diff?.newModules ?? []), ...(diff?.newCatalogs ?? [])].map(item => item.slug))
  const additions = new Map((diff?.extendedModules ?? []).map(item => [item.slug, new Set(item.fields)]))
  const groupBySlug = new Map<string, string>()
  if (navigation) {
    const slugById = new Map(navigation.entities.map(entity => [entity.id, entity.slug]))
    const byId = new Map(navigation.layout.groups.map(group => [group.id, group]))
    for (const group of navigation.layout.groups) for (const id of group.entityIds) {
      const slug = slugById.get(id)
      if (slug) groupBySlug.set(slug, group.parentId ? `${byId.get(group.parentId)?.name ?? 'Área'} / ${group.name}` : group.name)
    }
  }
  const modules: DiagramModule[] = blueprint.modules.map(module => {
    const old = existing.get(module.slug)
    const added = new Set([...(additions.get(module.slug) ?? []), ...module.fields.filter(field => !old?.fields.some(item => item.name === field.name)).map(field => field.name)])
    const state = newSlugs.has(module.slug) || module.action === 'create' ? 'new' : added.size || (diff?.states ?? []).some(item => item.slug === module.slug) ? 'extended' : 'existing'
    const fields: DiagramField[] = module.fields.map(field => ({ ...field, state: state === 'new' ? 'new' : added.has(field.name) ? 'added' : 'existing' }))
    const section = groupBySlug.get(module.slug) ?? (state === 'new' ? 'Propuesta' : module.kind === 'dimension' ? 'Catálogos' : 'Sin sección')
    return { id: module.slug, module, icon: module.icon ?? null, state, fields, section, width: 240, height: 48 + fields.length * 27 + (module.lines?.some(line => line.totals?.length) ? 28 : 0) } satisfies DiagramModule
  })
  const byRef = new Map(modules.flatMap(item => [[item.module.ref, item.id], [item.id, item.id]]))
  if (modules.some(item => item.fields.some(field => field.dataType === 'user')) || current.modules.some(module => module.fields.some(field => field.dataType === 'user'))) {
    modules.push({
      id: SYSTEM_USERS_ID,
      module: { ref: SYSTEM_USERS_ID, action: 'extend', kind: 'dimension', name: 'Usuarios', slug: SYSTEM_USERS_ID, fields: [] },
      icon: null, state: 'existing', fields: [], section: 'Sistema', width: 220, height: 88, system: true
    })
  }
  const lineKeys = new Set<string>()
  const edges: DiagramEdge[] = []
  for (const item of modules) for (const line of item.module.lines ?? []) {
    const child = byRef.get(line.childRef)
    if (!child) continue
    lineKeys.add(`${child}.${line.relationField}.${item.id}`)
    const old = existing.get(item.id)?.lines?.some(existingLine => existingLine.childRef === line.childRef && existingLine.relationField === line.relationField)
    edges.push({ id: `line:${item.id}:${child}:${line.relationField}`, source: item.id, target: child, label: `1 · partidas · N${line.totals?.length ? ` · total: ${line.totals.join(', ')}` : ''}`, kind: 'lines', state: old ? 'existing' : 'new' })
  }
  for (const item of modules) for (const field of item.fields) {
    if (field.dataType !== 'relation') continue
    const target = byRef.get(String(field.validationRules?.relationEntity ?? ''))
    if (!target || lineKeys.has(`${item.id}.${field.name}.${target}`)) continue
    edges.push({ id: `relation:${item.id}:${field.name}:${target}`, source: item.id, target, label: `N · ${field.label} · 1`, kind: 'relation', state: field.state === 'existing' ? 'existing' : 'new' })
  }
  if (modules.some(module => module.system)) for (const item of modules) for (const field of item.fields) {
    if (field.dataType !== 'user') continue
    const cardinality = field.validationRules?.unique === true ? '1..1' : field.validationRules?.multiple === true ? 'N..N' : 'N..1'
    edges.push({ id: `user:${item.id}:${field.name}`, source: item.id, target: SYSTEM_USERS_ID,
      label: `${cardinality} · ${field.label}${field.isOwnerField ? ' · responsable' : ''}`,
      kind: 'user', state: field.state === 'existing' ? 'existing' : 'new' })
  }
  const oldAssociations = new Set(current.associations.map(item => item.name))
  for (const association of blueprint.associations) {
    const source = byRef.get(association.sourceRef)
    const target = byRef.get(association.targetRef)
    if (source && target) edges.push({ id: `association:${association.name}`, source, target, label: `N · ${association.name} · N`, kind: 'association', state: oldAssociations.has(association.name) ? 'existing' : 'new' })
  }
  const sections = [...new Set(modules.filter(module => !module.system).map(module => module.section))]
    .map(title => ({ id: title, title, moduleIds: modules.filter(module => !module.system && module.section === title).map(module => module.id) }))
  if (modules.some(module => module.system)) sections.push({ id: SYSTEM_SECTION_ID, title: 'Sistema', moduleIds: [SYSTEM_USERS_ID] })
  return { modules, edges, sections }
}

export function visibleDesignerGraph(graph: DiagramGraph, search: string, section: string) {
  const needle = search.trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const modules = graph.modules.filter(module => {
    if (section && module.section !== section) return false
    const haystack = `${module.module.name} ${module.module.slug}`.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    return !needle || haystack.includes(needle)
  })
  const ids = new Set(modules.map(module => module.id))
  return { modules, edges: graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)), sections: graph.sections.filter(group => group.moduleIds.some(id => ids.has(id))) }
}

/** Conserva únicamente el módulo elegido, sus vecinos directos permitidos y las aristas que los unen. */
export function filterDesignerRelations(graph: DiagramGraph, selectedId: string | null, filter: DesignerRelationFilter): DiagramGraph {
  if (!selectedId || filter === 'none' || !graph.modules.some(module => module.id === selectedId)) return graph
  const byId = new Map(graph.modules.map(module => [module.id, module]))
  const edges = graph.edges.filter(edge => {
    const neighbor = edge.source === selectedId ? byId.get(edge.target) : edge.target === selectedId ? byId.get(edge.source) : undefined
    return neighbor && (filter === 'all' || (filter === 'catalogs' ? neighbor.system || neighbor.module.kind === 'dimension' : !neighbor.system && neighbor.module.kind === 'hecho'))
  })
  const ids = new Set([selectedId, ...edges.flatMap(edge => [edge.source, edge.target])])
  return {
    modules: graph.modules.filter(module => ids.has(module.id)),
    edges,
    sections: graph.sections.map(section => ({ ...section, moduleIds: section.moduleIds.filter(id => ids.has(id)) })).filter(section => section.moduleIds.length)
  }
}

/** Una arista elegida destaca exclusivamente sus dos extremos y ella misma. */
export function focusDesignerEdge(graph: DiagramGraph, edgeId: string | null) {
  const edge = graph.edges.find(item => item.id === edgeId)
  if (!edge) return { active: new Set(graph.modules.map(module => module.id)), edges: new Set(graph.edges.map(item => item.id)) }
  return { active: new Set([edge.source, edge.target]), edges: new Set([edge.id]) }
}

export function focusDesignerGraph(graph: DiagramGraph, focusId: string | null) {
  if (!focusId) return { active: new Set(graph.modules.map(module => module.id)), edges: new Set(graph.edges.map(edge => edge.id)) }
  const connected = graph.edges.filter(edge => edge.source === focusId || edge.target === focusId)
  return { active: new Set([focusId, ...connected.flatMap(edge => [edge.source, edge.target])]), edges: new Set(connected.map(edge => edge.id)) }
}

export type DesignerPositions = Record<string, { x: number; y: number }>
export function layoutDesignerGraph(graph: DiagramGraph, saved: DesignerPositions = {}) {
  const positions: DesignerPositions = {}
  const groups: Array<{ id: string; title: string; x: number; y: number; width: number; height: number }> = []
  let cursorX = 24
  let cursorY = 24
  let rowHeight = 0
  for (const section of graph.sections) {
    if (section.id === SYSTEM_SECTION_ID) continue
    const members = graph.modules.filter(module => !module.system && module.section === section.title)
    const ids = new Set(members.map(module => module.id))
    const layout = new dagre.graphlib.Graph()
    layout.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 90, marginx: 24, marginy: 52 })
    layout.setDefaultEdgeLabel(() => ({}))
    members.forEach(module => layout.setNode(module.id, { width: module.width, height: module.height }))
    graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).forEach(edge => layout.setEdge(edge.source, edge.target))
    dagre.layout(layout)
    const width = Math.max(290, layout.graph().width ?? 290)
    const height = Math.max(160, layout.graph().height ?? 160)
    if (cursorX + width > 1300 && cursorX > 24) { cursorX = 24; cursorY += rowHeight + 32; rowHeight = 0 }
    groups.push({ id: section.id, title: section.title, x: cursorX, y: cursorY, width, height })
    for (const module of members) {
      const node = layout.node(module.id)
      positions[module.id] = saved[module.id] ?? { x: cursorX + node.x - module.width / 2, y: cursorY + node.y - module.height / 2 }
    }
    cursorX += width + 32
    rowHeight = Math.max(rowHeight, height)
  }
  const system = graph.modules.find(module => module.system)
  if (system) {
    const x = Math.max(24, ...groups.map(group => group.x + group.width + 32))
    const y = 24
    groups.push({ id: SYSTEM_SECTION_ID, title: 'Sistema', x, y, width: 268, height: 180 })
    positions[system.id] = saved[system.id] ?? { x: x + 24, y: y + 56 }
  }
  return { positions, groups }
}
