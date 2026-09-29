import type { Blueprint } from '~/server/utils/blueprint/schema'

export interface DesignerValidationError {
  path: string
  message: string
  code?: string
}

export interface ReadableDesignerValidationError extends DesignerValidationError {
  label: string
  target: string | null
}

export function readableDesignerValidationErrors(errors: DesignerValidationError[], blueprint: Blueprint): ReadableDesignerValidationError[] {
  return errors.filter(error => error.code !== 'plan_limit').map(error => {
    const moduleMatch = error.path.match(/^modules\[(\d+)\](?:\.fields\[(\d+)\])?/)
    if (moduleMatch) {
      const module = blueprint.modules[Number(moduleMatch[1])]
      const field = moduleMatch[2] === undefined ? undefined : module?.fields[Number(moduleMatch[2])]
      const target = module?.slug ?? null
      const fieldName = field ? ` · ${field.label || field.name}` : ''
      return { ...error, label: module ? `${module.name}${fieldName}` : 'Módulo', target }
    }

    const associationMatch = error.path.match(/^associations\[(\d+)\]/)
    if (associationMatch) {
      const association = blueprint.associations[Number(associationMatch[1])]
      if (!association) return { ...error, label: 'Asociación', target: null }
      const source = blueprint.modules.find(module => module.ref === association.sourceRef || module.slug === association.sourceRef)?.name ?? association.sourceRef
      const destination = blueprint.modules.find(module => module.ref === association.targetRef || module.slug === association.targetRef)?.name ?? association.targetRef
      return { ...error, label: `${association.name} · entre ${source} y ${destination}`, target: `association:${association.name}` }
    }

    if (error.path.startsWith('modules')) return { ...error, label: 'Módulos', target: null }
    if (error.path.startsWith('roles')) return { ...error, label: 'Permisos por rol', target: null }
    return { ...error, label: 'Plano', target: null }
  })
}

export function buildDesignerRepairMessage(errors: ReadableDesignerValidationError[]): string {
  const details = errors.map(error => `- ${error.label}: ${error.message}`).join('\n')
  return `Corrige únicamente los errores de validación indicados en el plano. Conserva todo lo demás sin cambios y usa un parche pequeño.\n\n${details}`
}
