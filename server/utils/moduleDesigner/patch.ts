import { z } from 'zod'
import { blueprintFieldSchema, blueprintModuleSchema, blueprintSchema, type Blueprint } from '~/server/utils/blueprint/schema'
import { stateWorkflowSchema } from '~/server/utils/stateWorkflow'

const slug = z.string().trim().min(1)
const associationSchema = blueprintSchema.shape.associations.element
const roleSchema = blueprintSchema.shape.roles.unwrap().element
const permissionSchema = roleSchema.shape.permissions.element
const workflowShape = stateWorkflowSchema.innerType().shape
const patchTransitionSchema = workflowShape.transitions.element.extend({ roles: workflowShape.transitions.element.shape.roles.default('all') })

export const designerOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('addModule'), module: blueprintModuleSchema }).strict(),
  z.object({ op: z.literal('removeModule'), slug }).strict(),
  z.object({ op: z.literal('renameModule'), slug, name: slug, singularName: slug.optional() }).strict(),
  z.object({ op: z.literal('addField'), slug, field: blueprintFieldSchema }).strict(),
  z.object({ op: z.literal('updateField'), slug, name: slug, changes: blueprintFieldSchema.innerType().partial().strict() }).strict(),
  z.object({ op: z.literal('removeField'), slug, name: slug }).strict(),
  z.object({ op: z.literal('addAssociation'), association: associationSchema }).strict(),
  z.object({ op: z.literal('removeAssociation'), name: slug }).strict(),
  z.object({ op: z.literal('setStates'), slug, states: workflowShape.states, initial: slug.optional(), transitions: z.array(patchTransitionSchema).optional(), field: slug.optional() }).strict(),
  z.object({ op: z.literal('setRules'), slug, rules: workflowShape.rules.unwrap(), replace: z.boolean().optional() }).strict(),
  z.object({ op: z.literal('setRole'), role: roleSchema }).strict(),
  z.object({ op: z.literal('updateRolePermission'), role: slug, permission: permissionSchema }).strict()
])

export const designerPatchSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  explanation: z.string().trim().max(10000).optional(),
  mode: z.literal('patch'),
  operations: z.array(designerOperationSchema).min(1).max(100)
}).strict()

export type DesignerPatch = z.infer<typeof designerPatchSchema>
export interface PatchError { path: string; message: string }

/** El esquema compacto conserva identificadores, tipos y conexiones; omite instantáneas y reglas largas. */
export function compactDesignerBlueprint(blueprint: Blueprint) {
  return {
    version: blueprint.version,
    summary: blueprint.summary,
    modules: blueprint.modules.map(module => ({
      ref: module.ref, slug: module.slug, name: module.name, kind: module.kind, action: module.action,
      fields: module.fields.map(field => ({ name: field.name, label: field.label, dataType: field.dataType,
        ...(field.validationRules?.relationEntity ? { relationEntity: field.validationRules.relationEntity } : {}),
        ...(Array.isArray(field.validationRules?.options) ? { options: field.validationRules.options } : {}) })),
      lines: module.lines?.map(line => ({ childRef: line.childRef, relationField: line.relationField })),
      workflow: module.workflow ? { field: module.workflow.field, initial: module.workflow.initial, states: Object.keys(module.workflow.states), transitions: module.workflow.transitions.map(transition => ({ from: transition.from, to: transition.to })) } : undefined
    })),
    associations: blueprint.associations,
    roles: blueprint.roles?.map(role => ({ name: role.name, permissions: role.permissions }))
  }
}

export function applyDesignerPatch(current: Blueprint, input: unknown, tenant: Blueprint = current): { blueprint: Blueprint | null; errors: PatchError[]; patch: DesignerPatch | null } {
  const parsed = designerPatchSchema.safeParse(input)
  if (!parsed.success) return { blueprint: null, patch: null, errors: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) }
  const blueprint = structuredClone(current)
  const errors: PatchError[] = []
  const fail = (index: number, message: string) => errors.push({ path: `operations[${index}]`, message })
  const moduleFor = (slug: string) => blueprint.modules.find(module => module.slug === slug)
  const tenantModuleFor = (slug: string) => tenant.modules.find(module => module.slug === slug)
  for (const [index, operation] of parsed.data.operations.entries()) {
    const module = 'slug' in operation ? moduleFor(operation.slug) : undefined
    if ('slug' in operation && !module) { fail(index, `El módulo «${operation.slug}» no existe en el plano vigente`); break }
    switch (operation.op) {
      case 'addModule':
        if (moduleFor(operation.module.slug) || blueprint.modules.some(item => item.ref === operation.module.ref)) fail(index, `El módulo «${operation.module.slug}» o su referencia ya existe`)
        else if (operation.module.snapshot || operation.module.action !== 'create') fail(index, 'Un módulo nuevo debe usar action create y no puede ser una instantánea')
        else blueprint.modules.push(operation.module)
        break
      case 'removeModule':
        if (module!.snapshot || tenantModuleFor(operation.slug)) fail(index, `No se puede eliminar el módulo existente «${operation.slug}»`)
        else blueprint.modules.splice(blueprint.modules.indexOf(module!), 1)
        break
      case 'renameModule':
        if (module!.snapshot || tenantModuleFor(operation.slug)) fail(index, `No se puede renombrar el módulo existente «${operation.slug}»`)
        else { module!.name = operation.name; if (operation.singularName) module!.singularName = operation.singularName }
        break
      case 'addField':
        if (module!.fields.some(field => field.name === operation.field.name)) fail(index, `El campo «${operation.field.name}» ya existe en «${operation.slug}»`)
        else module!.fields.push(operation.field)
        break
      case 'updateField': {
        const field = module!.fields.find(item => item.name === operation.name)
        if (!field) fail(index, `El campo «${operation.name}» no existe en «${operation.slug}»`)
        else if (tenantModuleFor(operation.slug)?.fields.some(item => item.name === operation.name)) fail(index, `No se puede modificar el campo existente «${operation.name}»`)
        else if (operation.changes.name && operation.changes.name !== operation.name && module!.fields.some(item => item.name === operation.changes.name)) fail(index, `El campo «${operation.changes.name}» ya existe en «${operation.slug}»`)
        else Object.assign(field, operation.changes)
        break
      }
      case 'removeField': {
        const fieldIndex = module!.fields.findIndex(field => field.name === operation.name)
        if (fieldIndex < 0) fail(index, `El campo «${operation.name}» no existe en «${operation.slug}»`)
        else if (tenantModuleFor(operation.slug)?.fields.some(item => item.name === operation.name)) fail(index, `No se puede eliminar el campo existente «${operation.name}»`)
        else module!.fields.splice(fieldIndex, 1)
        break
      }
      case 'addAssociation':
        if (blueprint.associations.some(item => item.name === operation.association.name)) fail(index, `La asociación «${operation.association.name}» ya existe`)
        else blueprint.associations.push(operation.association)
        break
      case 'removeAssociation': {
        const associationIndex = blueprint.associations.findIndex(item => item.name === operation.name)
        if (associationIndex < 0) fail(index, `La asociación «${operation.name}» no existe`)
        else if (tenant.associations.some(item => item.name === operation.name)) fail(index, `No se puede eliminar la asociación existente «${operation.name}»`)
        else blueprint.associations.splice(associationIndex, 1)
        break
      }
      case 'setStates':
        if (module!.snapshot || tenantModuleFor(operation.slug)?.workflow) fail(index, `No se puede modificar el flujo existente de «${operation.slug}»`)
        else module!.workflow = { enabled: true, field: operation.field ?? module!.workflow?.field ?? 'estado', initial: operation.initial ?? module!.workflow?.initial ?? Object.keys(operation.states)[0] ?? '', states: { ...module!.workflow?.states, ...operation.states }, transitions: [...(module!.workflow?.transitions ?? []), ...(operation.transitions ?? []).filter(next => !module!.workflow?.transitions.some(existing => existing.from === next.from && existing.to === next.to))], rules: module!.workflow?.rules ?? [] }
        break
      case 'setRules':
        if (module!.snapshot || tenantModuleFor(operation.slug)?.workflow) fail(index, `No se pueden modificar las reglas existentes de «${operation.slug}»`)
        else if (!module!.workflow) fail(index, `El módulo «${operation.slug}» no tiene un flujo de estados`)
        else if (operation.replace) module!.workflow.rules = operation.rules
        else {
          const rules = [...(module!.workflow.rules ?? [])]
          for (const rule of operation.rules) {
            const existing = rule.id ? rules.findIndex(item => item.id === rule.id) : rules.findIndex(item => JSON.stringify(item) === JSON.stringify(rule))
            if (existing < 0) rules.push(rule)
            else if (rule.id) rules[existing] = rule
          }
          module!.workflow.rules = rules
        }
        break
      case 'setRole': {
        const roles = blueprint.roles ?? (blueprint.roles = [])
        const roleIndex = roles.findIndex(role => role.name === operation.role.name)
        if (roleIndex < 0) roles.push(operation.role)
        else roles[roleIndex] = operation.role
        break
      }
      case 'updateRolePermission': {
        const role = blueprint.roles?.find(item => item.name === operation.role)
        if (!role) fail(index, `El rol «${operation.role}» no existe en el plano vigente`)
        else {
          const permissionIndex = role.permissions.findIndex(item => item.moduleRef === operation.permission.moduleRef)
          if (permissionIndex < 0) role.permissions.push(operation.permission)
          else role.permissions[permissionIndex] = operation.permission
        }
        break
      }
    }
    if (errors.length) break
  }
  return { blueprint: errors.length ? null : blueprint, errors, patch: parsed.data }
}
