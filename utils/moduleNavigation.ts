import { z } from 'zod'

// Presentation metadata only: grouping never grants record permissions.
const groupSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(80),
  icon: z.string().max(80).nullable(), parentId: z.string().uuid().nullable(),
  entityIds: z.array(z.string().uuid()).max(1000)
})
export const navigationLayoutSchema = z.object({ groups: z.array(groupSchema).max(100) }).superRefine(({ groups }, ctx) => {
  const byId = new Map(groups.map(group => [group.id, group]))
  const assigned = new Set<string>()
  if (byId.size !== groups.length) ctx.addIssue({ code: 'custom', message: 'Hay grupos duplicados' })
  for (const group of groups) {
    if (group.parentId && (group.parentId === group.id || !byId.has(group.parentId) || byId.get(group.parentId)?.parentId !== null)) {
      ctx.addIssue({ code: 'custom', message: 'Un subproceso debe pertenecer a un área. Solo se permiten dos niveles.' })
    }
    for (const id of group.entityIds) {
      if (assigned.has(id)) ctx.addIssue({ code: 'custom', message: 'Cada módulo solo puede estar en un grupo' })
      assigned.add(id)
    }
  }
})
export type NavigationLayout = z.infer<typeof navigationLayoutSchema>
export type NavigationGroup = NavigationLayout['groups'][number]
export interface NavigationEntity {
  id: string; slug: string; name: string; icon: string | null; moduleKind: string; showInMenu?: boolean
}
export interface NavigationNode {
  id: string; name: string; icon: string | null
  modules: NavigationEntity[]; catalogs: NavigationEntity[]; children: NavigationNode[]
}
export function buildNavigation(layout: NavigationLayout, readableEntities: NavigationEntity[]) {
  const visible = readableEntities.filter(entity => entity.showInMenu !== false && entity.moduleKind === 'hecho')
  const byId = new Map(visible.map(entity => [entity.id, entity]))
  const assigned = new Set(layout.groups.flatMap(group => group.entityIds))
  function node(group: NavigationGroup): NavigationNode {
    const items = group.entityIds.flatMap(id => byId.has(id) ? [byId.get(id)!] : [])
    return {
      id: group.id, name: group.name, icon: group.icon,
      modules: items.filter(item => item.moduleKind === 'hecho'),
      catalogs: items.filter(item => item.moduleKind === 'dimension'),
      children: layout.groups.filter(child => child.parentId === group.id).map(node).filter(hasItems)
    }
  }
  function hasItems(group: NavigationNode): boolean { return !!(group.modules.length || group.catalogs.length || group.children.length) }
  return {
    groups: layout.groups.filter(group => !group.parentId).map(node).filter(hasItems),
    unassigned: visible.filter(entity => !assigned.has(entity.id) && entity.moduleKind === 'hecho')
  }
}
