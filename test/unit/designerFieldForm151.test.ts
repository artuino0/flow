import { describe, expect, it } from 'vitest'
import type { Blueprint, BlueprintField } from '~/server/utils/blueprint/schema'
import { blueprintFieldToDraft, fieldDraftToBlueprint, uniqueDesignerFieldName, designerFieldFormSource, designerFieldIsEditable } from '~/utils/designerFieldForm'

const current: Blueprint = { version: 1, summary: 'Actual', associations: [], modules: [
  { ref: 'base', slug: 'clientes', name: 'Clientes', action: 'extend', kind: 'dimension', snapshot: true, fields: [{ name: 'nombre', label: 'Nombre', dataType: 'text', required: true }] }
] }
const working: Blueprint = { ...current, modules: [
  { ...current.modules[0]!, fields: [{ name: 'saldo', label: 'Saldo', dataType: 'currency' }] },
  { ref: 'nuevo', slug: 'ventas', name: 'Ventas', action: 'create', kind: 'hecho', fields: [{ name: 'cliente', label: 'Cliente', dataType: 'relation', validationRules: { relationEntity: 'base' } }, { name: 'total', label: 'Total', dataType: 'number' }] }
] }
describe('campos del diseñador HU-151', () => {
  it.each<BlueprintField>([
    { name: 'responsable', label: 'Responsable', dataType: 'user', required: true, isOwnerField: true, validationRules: { multiple: false } },
    { name: 'estado', label: 'Estado', dataType: 'select', required: false, validationRules: { options: [{ value: 'a', label: 'Activo', color: 'blue' }] } },
    { name: 'cliente', label: 'Cliente', dataType: 'relation', validationRules: { relationEntity: 'clientes' } },
    { name: 'total', label: 'Total', dataType: 'number', validationRules: { calculation: { kind: 'expression', expression: 'precio * cantidad' } } },
    { name: 'items', label: 'Items', dataType: 'tabla', validationRules: { columns: [{ name: 'cliente', label: 'Cliente', type: 'relation', relationEntity: 'clientes' }, { name: 'nombre', label: 'Nombre', type: 'text', copyFrom: 'clientes.nombre', editable: true }] } }
  ])('mapea $name sin perder reglas y sin compartir referencias', field => {
    const before = structuredClone(field)
    const draft = blueprintFieldToDraft(field)
    expect(draft.isRequired).toBe(Boolean(field.required))
    expect(draft.isOwnerField).toBe(Boolean(field.isOwnerField))
    expect(fieldDraftToBlueprint(draft)).toEqual({ ...field, required: Boolean(field.required), isOwnerField: Boolean(field.isOwnerField) })
    draft.validationRules.other = true
    expect(field).toEqual(before)
  })
  it('encuentra el primer nombre libre, aun con huecos y campos existentes', () => {
    const fields = ['nuevo_campo_1', 'nuevo_campo_3'].map(name => ({ name, label: name, dataType: 'text' as const }))
    expect(uniqueDesignerFieldName(fields)).toBe('nuevo_campo_2')
    expect(uniqueDesignerFieldName([])).toBe('nuevo_campo_1')
  })
  it('une la instantánea, ampliaciones y propuestas, sin usuarios sintéticos ni mutaciones', () => {
    const before = structuredClone({ current, working })
    const source = designerFieldFormSource(current, working)
    expect(source.entities.map(entity => entity.slug)).toEqual(['clientes', 'ventas'])
    expect(source.fieldsByEntity.clientes!.map(field => field.name)).toEqual(['nombre', 'saldo'])
    expect(source.fieldsByEntity.ventas![0]!.validationRules.relationEntity).toBe('clientes')
    expect(source.fieldsByEntity.ventas![1]!.dataType).toBe('number')
    expect({ current, working }).toEqual(before)
    expect(designerFieldFormSource(null, null)).toEqual({ entities: [], fieldsByEntity: {} })
  })
  it('normaliza referencias en tablas y acumulados sin alterar el plano', () => {
    const proposal = structuredClone(working)
    proposal.modules[1]!.fields.push({ name: 'items', label: 'Items', dataType: 'tabla', validationRules: { columns: [
      { name: 'cliente', label: 'Cliente', type: 'relation', relationEntity: 'base' },
      { name: 'nombre', label: 'Nombre', type: 'text', copyFrom: 'base.nombre' }
    ] } }, { name: 'acumulado', label: 'Acumulado', dataType: 'number', validationRules: { calculation: { kind: 'rollup', sourceEntity: 'base', aggregate: 'count', relationField: 'venta' } } })
    const before = structuredClone(proposal)
    const source = designerFieldFormSource(current, proposal)
    expect(source.fieldsByEntity.ventas![2]!.validationRules.columns).toEqual([
      { name: 'cliente', label: 'Cliente', type: 'relation', relationEntity: 'clientes' },
      { name: 'nombre', label: 'Nombre', type: 'text', copyFrom: 'clientes.nombre' }
    ])
    expect(source.fieldsByEntity.ventas![3]!.validationRules.calculation).toMatchObject({ sourceEntity: 'clientes' })
    expect(proposal).toEqual(before)
  })
  it('bloquea existentes y falla cerrado hasta cargar la instantánea', () => {
    expect(designerFieldIsEditable(current, 'clientes', 'nombre')).toBe(false)
    expect(designerFieldIsEditable(null, 'clientes', 'nombre')).toBe(false)
    expect(designerFieldIsEditable(current, 'clientes', 'saldo')).toBe(true)
    expect(designerFieldIsEditable(current, 'ventas', 'total')).toBe(true)
  })
})
