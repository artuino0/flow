import { describe, expect, it } from 'vitest'
import type { Blueprint } from '../../server/utils/blueprint/schema'
import { buildDesignerRepairMessage, readableDesignerValidationErrors } from '../../utils/designerValidationErrors'

const blueprint: Blueprint = {
  version: 1,
  summary: 'Clínica',
  modules: [{ ref: 'citas', action: 'create', kind: 'hecho', name: 'Citas', slug: 'citas', fields: [{ name: 'fecha', label: 'Fecha de cita', dataType: 'date' }] }],
  associations: [{ name: 'Cita con cita', sourceRef: 'citas', targetRef: 'citas' }]
}

describe('errores de validación legibles del diseñador', () => {
  it('traduce rutas de módulos, campos y asociaciones a sus nombres visibles', () => {
    const errors = readableDesignerValidationErrors([
      { path: 'modules[0].fields[0].name', message: 'Nombre inválido' },
      { path: 'associations[0].targetRef', message: 'No puede relacionarse consigo mismo' },
      { path: 'modules', message: 'Límite excedido', code: 'plan_limit' }
    ], blueprint)
    expect(errors).toEqual([
      { path: 'modules[0].fields[0].name', message: 'Nombre inválido', label: 'Citas · Fecha de cita', target: 'citas' },
      { path: 'associations[0].targetRef', message: 'No puede relacionarse consigo mismo', label: 'Cita con cita · entre Citas y Citas', target: 'association:Cita con cita' }
    ])
  })

  it('construye una instrucción de corrección que pide preservar el resto del plano', () => {
    const errors = readableDesignerValidationErrors([{ path: 'associations[0].targetRef', message: 'No puede relacionarse consigo mismo' }], blueprint)
    expect(buildDesignerRepairMessage(errors)).toBe('Corrige únicamente los errores de validación indicados en el plano. Conserva todo lo demás sin cambios y usa un parche pequeño.\n\n- Cita con cita · entre Citas y Citas: No puede relacionarse consigo mismo')
  })
})
