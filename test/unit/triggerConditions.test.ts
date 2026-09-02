import { describe, it, expect } from 'vitest'
import { evaluateCondition, collectConditionFields, conditionNodeSchema } from '../../server/utils/triggers'

// HU-ERD-48: cubre el evaluador de condiciones (DSL declarativo JSON), sin
// necesitar una base de datos - evaluateCondition() es pura, mismo criterio
// que buildFieldType() en dynamicSchema.ts (HU-ERD-17/29).

describe('evaluateCondition', () => {
  describe('operadores', () => {
    it('eq', () => {
      expect(evaluateCondition({ field: 'estado', operator: 'eq', value: 'nuevo' }, { estado: 'nuevo' })).toBe(true)
      expect(evaluateCondition({ field: 'estado', operator: 'eq', value: 'nuevo' }, { estado: 'cerrado' })).toBe(false)
    })

    it('neq', () => {
      expect(evaluateCondition({ field: 'estado', operator: 'neq', value: 'nuevo' }, { estado: 'cerrado' })).toBe(true)
      expect(evaluateCondition({ field: 'estado', operator: 'neq', value: 'nuevo' }, { estado: 'nuevo' })).toBe(false)
    })

    it('gt/gte/lt/lte con numeros', () => {
      expect(evaluateCondition({ field: 'monto', operator: 'gt', value: 100 }, { monto: 150 })).toBe(true)
      expect(evaluateCondition({ field: 'monto', operator: 'gt', value: 100 }, { monto: 100 })).toBe(false)
      expect(evaluateCondition({ field: 'monto', operator: 'gte', value: 100 }, { monto: 100 })).toBe(true)
      expect(evaluateCondition({ field: 'monto', operator: 'lt', value: 100 }, { monto: 50 })).toBe(true)
      expect(evaluateCondition({ field: 'monto', operator: 'lte', value: 100 }, { monto: 100 })).toBe(true)
    })

    it('gt/gte/lt/lte con un valor no numerico siempre da false (nunca lanza)', () => {
      expect(evaluateCondition({ field: 'monto', operator: 'gt', value: 100 }, { monto: 'no-es-numero' })).toBe(false)
      expect(evaluateCondition({ field: 'monto', operator: 'gt', value: 100 }, {})).toBe(false)
    })

    it('contains sobre string', () => {
      expect(evaluateCondition({ field: 'nombre', operator: 'contains', value: 'Acme' }, { nombre: 'Acme Corp' })).toBe(true)
      expect(evaluateCondition({ field: 'nombre', operator: 'contains', value: 'Acme' }, { nombre: 'Otra' })).toBe(false)
    })

    it('contains sobre array (multiselect)', () => {
      expect(evaluateCondition({ field: 'etiquetas', operator: 'contains', value: 'urgente' }, { etiquetas: ['urgente', 'vip'] })).toBe(true)
      expect(evaluateCondition({ field: 'etiquetas', operator: 'contains', value: 'urgente' }, { etiquetas: ['vip'] })).toBe(false)
    })
  })

  describe('combinadores AND/OR', () => {
    it('and: todas las hojas deben ser true', () => {
      const condition = {
        and: [
          { field: 'estado', operator: 'eq', value: 'nuevo' },
          { field: 'monto', operator: 'gt', value: 1000 }
        ]
      }
      expect(evaluateCondition(condition, { estado: 'nuevo', monto: 1500 })).toBe(true)
      expect(evaluateCondition(condition, { estado: 'nuevo', monto: 500 })).toBe(false)
    })

    it('or: alcanza con una hoja true', () => {
      const condition = {
        or: [
          { field: 'estado', operator: 'eq', value: 'urgente' },
          { field: 'monto', operator: 'gt', value: 10000 }
        ]
      }
      expect(evaluateCondition(condition, { estado: 'urgente', monto: 1 })).toBe(true)
      expect(evaluateCondition(condition, { estado: 'normal', monto: 20000 })).toBe(true)
      expect(evaluateCondition(condition, { estado: 'normal', monto: 1 })).toBe(false)
    })

    it('anidado: and dentro de or', () => {
      const condition = {
        or: [
          { and: [{ field: 'pais', operator: 'eq', value: 'MX' }, { field: 'monto', operator: 'gte', value: 5000 }] },
          { field: 'vip', operator: 'eq', value: true }
        ]
      }
      expect(evaluateCondition(condition, { pais: 'MX', monto: 6000, vip: false })).toBe(true)
      expect(evaluateCondition(condition, { pais: 'MX', monto: 100, vip: false })).toBe(false)
      expect(evaluateCondition(condition, { pais: 'US', monto: 100, vip: true })).toBe(true)
    })
  })

  describe('formas invalidas', () => {
    it('un condition vacio ({}) no matchea el schema (ni leaf ni and/or) - tira, no "siempre true"', () => {
      expect(() => evaluateCondition({}, { estado: 'nuevo' })).toThrow()
    })

    it('un operador fuera de la lista cerrada es rechazado por el schema', () => {
      expect(() => evaluateCondition({ field: 'x', operator: 'eval', value: 1 }, {})).toThrow()
    })

    it('nunca ejecuta codigo arbitrario: un value con forma de funcion/codigo se trata como dato, no como expresion', () => {
      const condition = { field: 'x', operator: 'eq', value: 'process.exit(1)' }
      // El "valor" es un string literal cualquiera - comparado tal cual, no evaluado.
      expect(evaluateCondition(condition, { x: 'process.exit(1)' })).toBe(true)
      expect(evaluateCondition(condition, { x: 'otra cosa' })).toBe(false)
    })
  })
})

describe('collectConditionFields', () => {
  it('devuelve el campo de una hoja simple', () => {
    const node = conditionNodeSchema.parse({ field: 'estado', operator: 'eq', value: 'x' })
    expect(collectConditionFields(node)).toEqual(['estado'])
  })

  it('devuelve todos los campos referenciados en un arbol anidado, sin duplicados forzados', () => {
    const node = conditionNodeSchema.parse({
      or: [
        { and: [{ field: 'pais', operator: 'eq', value: 'MX' }, { field: 'monto', operator: 'gte', value: 5000 }] },
        { field: 'vip', operator: 'eq', value: true }
      ]
    })
    expect(collectConditionFields(node).sort()).toEqual(['monto', 'pais', 'vip'])
  })
})
