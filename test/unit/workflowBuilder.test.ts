import { describe, expect, it } from 'vitest'
import { evaluateCondition } from '../../server/utils/triggers'
import { workflowValue } from '../../utils/workflowFields'

describe('workflow entry conditions', () => {
  it('requires an explicit all-records choice', () => {
    expect(evaluateCondition({ always: true }, {})).toBe(true)
    expect(() => evaluateCondition({}, {})).toThrow()
  })
  it('only matches a changed field when previous values are available', () => {
    const condition = { field: 'estado', operator: 'changed', value: null }
    expect(evaluateCondition(condition, { estado: 'listo' })).toBe(false)
    expect(evaluateCondition(condition, { estado: 'listo' }, { estado: 'listo' })).toBe(false)
    expect(evaluateCondition(condition, { estado: 'listo' }, { estado: 'pendiente' })).toBe(true)
    expect(evaluateCondition(condition, {}, { estado: 'listo' })).toBe(true)
  })
  it('combines a transition with its destination', () => {
    const condition = { and: [{ field: 'estado', operator: 'changed', value: null }, { field: 'estado', operator: 'eq', value: 'listo' }] }
    expect(evaluateCondition(condition, { estado: 'listo' }, { estado: 'pendiente' })).toBe(true)
    expect(evaluateCondition(condition, { estado: 'cancelado' }, { estado: 'pendiente' })).toBe(false)
  })
  it('preserves numeric-looking text and uses field types for numbers and booleans', () => {
    expect(workflowValue('00123', { name: 'folio', dataType: 'text' })).toBe('00123')
    expect(workflowValue('false', { name: 'texto', dataType: 'text' })).toBe('false')
    expect(workflowValue('1.5', { name: 'peso', dataType: 'number' })).toBe(1.5)
    expect(workflowValue('false', { name: 'activo', dataType: 'boolean' })).toBe(false)
    expect(workflowValue('true', { name: 'activo', dataType: 'boolean' })).toBe(true)
  })
})
