import { describe, expect, it } from 'vitest'
import { applyDesignerPatch, compactDesignerBlueprint } from '../../server/utils/moduleDesigner/patch'
import type { Blueprint } from '../../server/utils/blueprint/schema'

const current: Blueprint = {
  version: 1, summary: 'Clínica', associations: [{ name: 'Cita doctor', sourceRef: 'citas', targetRef: 'doctores' }],
  modules: [
    { ref: 'citas', action: 'create', kind: 'hecho', name: 'Citas', slug: 'citas', fields: [
      { name: 'nota', label: 'Nota', dataType: 'text' },
      { name: 'estado', label: 'Estado', dataType: 'select', validationRules: { options: [{ value: 'nueva', label: 'Nueva' }] } }
    ], workflow: { enabled: true, field: 'estado', initial: 'nueva', states: { nueva: { locked: false, editableFields: [] } }, transitions: [] } },
    { ref: 'doctores', action: 'create', kind: 'dimension', name: 'Doctores', slug: 'doctores', fields: [] },
    { ref: 'clientes', action: 'extend', kind: 'dimension', name: 'Clientes', slug: 'clientes', snapshot: true, fields: [{ name: 'nombre', label: 'Nombre', dataType: 'text' }] }
  ],
  roles: [{ name: 'Recepción', permissions: [] }]
}
const reply = (...operations: unknown[]) => ({ mode: 'patch', message: 'Ajusté la clínica', explanation: 'Agregué lo solicitado.', operations })
const permission = { moduleRef: 'citas', visibility: 'all', canRead: true, canCreate: true, canUpdate: true, canDelete: false }
const emptyTenant: Blueprint = { version: 1, summary: 'Tenant vacío', modules: [], associations: [] }

describe('parches del diseñador', () => {
  it('aplica operaciones mínimas sobre una copia y conserva lo demás exactamente', () => {
    const before = structuredClone(current)
    const applied = applyDesignerPatch(current, reply(
      { op: 'addField', slug: 'citas', field: { name: 'motivo', label: 'Motivo', dataType: 'text' } },
      { op: 'updateField', slug: 'citas', name: 'motivo', changes: { label: 'Motivo de consulta' } },
      { op: 'removeField', slug: 'citas', name: 'nota' },
      { op: 'renameModule', slug: 'citas', name: 'Consultas' }
    ), emptyTenant)
    const expected = structuredClone(before)
    expected.modules[0]!.name = 'Consultas'
    expected.modules[0]!.fields = [before.modules[0]!.fields[1]!, { name: 'motivo', label: 'Motivo de consulta', dataType: 'text' }]
    expect(applied.errors).toEqual([])
    expect(applied.blueprint).toEqual(expected)
    expect(current).toEqual(before)
  })

  it('aplica módulos, asociaciones, estados, reglas y permisos', () => {
    const rule = { type: 'required', mode: 'block', when: { to: 'confirmada' }, fields: ['motivo'], message: 'Falta motivo' }
    const applied = applyDesignerPatch(current, reply(
      { op: 'addModule', module: { ref: 'salas', action: 'create', kind: 'dimension', name: 'Salas', slug: 'salas', fields: [] } },
      { op: 'removeModule', slug: 'doctores' },
      { op: 'removeAssociation', name: 'Cita doctor' },
      { op: 'addAssociation', association: { name: 'Cita sala', sourceRef: 'citas', targetRef: 'salas' } },
      { op: 'addField', slug: 'citas', field: { name: 'motivo', label: 'Motivo', dataType: 'text' } },
      { op: 'setStates', slug: 'citas', states: { nueva: { locked: false, editableFields: [] }, confirmada: { locked: true, editableFields: [] } }, transitions: [{ from: 'nueva', to: 'confirmada' }] },
      { op: 'setRules', slug: 'citas', rules: [rule] },
      { op: 'setRole', role: { name: 'Doctor', permissions: [permission] } },
      { op: 'updateRolePermission', role: 'Recepción', permission }
    ), { version: 1, summary: 'Tenant', modules: [], associations: [] })
    expect(applied.errors).toEqual([])
    expect(applied.blueprint?.modules.map(module => module.slug)).toEqual(['citas', 'clientes', 'salas'])
    expect(applied.blueprint?.associations).toEqual([{ name: 'Cita sala', sourceRef: 'citas', targetRef: 'salas' }])
    expect(applied.blueprint?.modules[0]?.workflow).toEqual({ enabled: true, field: 'estado', initial: 'nueva', states: { nueva: { locked: false, editableFields: [] }, confirmada: { locked: true, editableFields: [] } }, transitions: [{ from: 'nueva', to: 'confirmada', roles: 'all' }], rules: [rule] })
    expect(applied.blueprint?.roles).toEqual([{ name: 'Recepción', permissions: [permission] }, { name: 'Doctor', permissions: [permission] }])
  })

  it('rechaza referencias inexistentes, duplicados y cambios a instantáneas con ruta de operación', () => {
    for (const operation of [
      { op: 'addField', slug: 'ausente', field: { name: 'x', label: 'X', dataType: 'text' } },
      { op: 'addField', slug: 'citas', field: { name: 'nota', label: 'Nota', dataType: 'text' } },
      { op: 'updateField', slug: 'citas', name: 'ausente', changes: { label: 'X' } },
      { op: 'removeModule', slug: 'clientes' },
      { op: 'updateField', slug: 'clientes', name: 'nombre', changes: { label: 'Otro' } },
      { op: 'removeAssociation', name: 'ausente' }
    ]) {
      const result = applyDesignerPatch(current, reply(operation))
      expect(result.blueprint).toBeNull()
      expect(result.errors[0]?.path).toBe('operations[0]')
      expect(result.errors[0]?.message).toBeTruthy()
    }
    expect(applyDesignerPatch(current, reply({ op: 'removeAssociation', name: 'Cita doctor' })).errors[0]?.message).toContain('existente')
  })

  it('conserva reglas anteriores salvo sustitución explícita', () => {
    const withRule = structuredClone(current)
    const oldRule = { id: 'antigua', type: 'required' as const, mode: 'block' as const, when: { to: 'nueva' }, fields: ['nota'], message: 'Captura nota' }
    const newRule = { id: 'nueva', type: 'required' as const, mode: 'warn' as const, when: { to: 'nueva' }, fields: ['nota'], message: 'Revisa nota' }
    withRule.modules[0]!.workflow!.rules = [oldRule]
    expect(applyDesignerPatch(withRule, reply({ op: 'setRules', slug: 'citas', rules: [newRule] }), emptyTenant).blueprint?.modules[0]?.workflow?.rules).toEqual([oldRule, newRule])
    expect(applyDesignerPatch(withRule, reply({ op: 'setRules', slug: 'citas', rules: [newRule], replace: true }), emptyTenant).blueprint?.modules[0]?.workflow?.rules).toEqual([newRule])
  })

  it('valida el formato y reduce el contexto sin perder identificadores', () => {
    expect(applyDesignerPatch(current, reply({ op: 'desconocida' })).errors[0]?.path).toContain('operations')
    const compact = compactDesignerBlueprint(current)
    expect(compact.modules[0]?.fields.map(field => field.name)).toEqual(['nota', 'estado'])
    expect(compact.modules[0]?.workflow?.states).toEqual(['nueva'])
    expect(JSON.stringify(compact)).not.toContain('snapshot')
  })
})
