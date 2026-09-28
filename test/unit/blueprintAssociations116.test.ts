import { describe, expect, it } from 'vitest'
import type { Blueprint } from '~/server/utils/blueprint/schema'
import { validateBlueprintAgainstSnapshot } from '~/server/utils/blueprint/validate'
import { normalizeDesignerAssociations } from '~/server/utils/moduleDesigner/normalizeAssociations'

const empty: Blueprint = { version: 1, summary: 'Actual', modules: [], associations: [] }

describe('asociaciones del diseñador', () => {
  it('rechaza una asociación de un módulo consigo mismo', async () => {
    const blueprint: Blueprint = { version: 1, summary: 'Clínica', modules: [
      { ref: 'perfiles-doctor', action: 'create', kind: 'dimension', name: 'Perfiles de doctor', slug: 'perfiles-doctor', fields: [
        { name: 'usuario', label: 'Usuario', dataType: 'user', validationRules: { unique: true } }
      ] }
    ], associations: [{ name: 'Perfil de usuario doctor', sourceRef: 'perfiles-doctor', targetRef: 'perfiles-doctor' }] }
    const result = await validateBlueprintAgainstSnapshot(blueprint, empty)
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'associations[0].targetRef', message: expect.stringContaining('consigo mismo') })]))
  })

  it('quita vínculos que ya expresa relation o user y conserva la auto-asociación para que el validador la rechace', () => {
    const blueprint: Blueprint = { version: 1, summary: 'Agenda', modules: [
      { ref: 'clientes', action: 'create', kind: 'dimension', name: 'Clientes', slug: 'clientes', fields: [] },
      { ref: 'citas', action: 'create', kind: 'hecho', name: 'Citas', slug: 'citas', fields: [
        { name: 'cliente', label: 'Cliente', dataType: 'relation', validationRules: { relationEntity: 'clientes' } },
        { name: 'doctor', label: 'Doctor', dataType: 'user' }
      ] }
    ], associations: [
      { name: 'Cita cliente', sourceRef: 'clientes', targetRef: 'citas' },
      { name: 'Doctor usuario', sourceRef: 'citas', targetRef: 'usuarios' },
      { name: 'Cita consigo misma', sourceRef: 'citas', targetRef: 'citas' }
    ] }
    const normalized = normalizeDesignerAssociations(blueprint)
    expect((normalized.blueprint as Blueprint).associations.map(item => item.name)).toEqual(['Cita consigo misma'])
    expect(normalized.warnings).toHaveLength(2)
    expect(normalized.warnings.every(warning => warning.startsWith('Omití la asociación'))).toBe(true)
    expect(blueprint.associations).toHaveLength(3)
  })
})
