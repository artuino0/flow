import { describe, it, expect } from 'vitest'
import { validateFieldValue } from '../../utils/validateFieldValue'
import type { EntityFieldMeta } from '../../composables/useEntityFields'

// HU-ERD-23: validacion "espejo" en cliente (feedback inmediato en
// DynamicForm.vue) - nunca reemplaza la revalidacion real del servidor
// (server/utils/dynamicSchema.ts, cubierto en test/unit/dynamicSchema.test.ts).
// Este archivo cubria hasta ahora 0 casos; se agrega foco en el caso 'tabla'
// (HU-ERD-72), el unico agregado nuevo de esta HU en este archivo.

function field(overrides: Partial<EntityFieldMeta> = {}): EntityFieldMeta {
  return {
    id: 'f1',
    name: 'items',
    label: 'Items',
    dataType: 'tabla',
    validationRules: {},
    isRequired: false,
    ...overrides
  }
}

describe('validateFieldValue', () => {
  describe('tabla (HU-ERD-72)', () => {
    const columns = [
      { name: 'producto_id', type: 'relation' },
      { name: 'cantidad', type: 'number' },
      { name: 'subtotal', type: 'number' }
    ]

    it('un array vacio es valido si el campo no es requerido', () => {
      const result = validateFieldValue(field({ isRequired: false }), [])
      expect(result.valid).toBe(true)
    })

    it('un array vacio es invalido si el campo es requerido (no cae en isEmpty() generico)', () => {
      const result = validateFieldValue(field({ isRequired: true }), [])
      expect(result.valid).toBe(false)
      expect(result.error).toContain('al menos una fila')
    })

    it('un valor que no es array se trata como sin filas', () => {
      const result = validateFieldValue(field({ isRequired: true }), 'no es un array')
      expect(result.valid).toBe(false)
    })

    it('acepta filas donde las columnas de relacion tienen forma de uuid', () => {
      const result = validateFieldValue(field({ validationRules: { columns } }), [
        { producto_id: '11111111-1111-1111-1111-111111111111', cantidad: 2, subtotal: 200 }
      ])
      expect(result.valid).toBe(true)
    })

    it('rechaza una fila con una columna de relacion sin forma de uuid', () => {
      const result = validateFieldValue(field({ validationRules: { columns } }), [
        { producto_id: 'no-es-un-uuid', cantidad: 2, subtotal: 200 }
      ])
      expect(result.valid).toBe(false)
      expect(result.error).toContain('producto_id')
    })

    it('una columna de relacion vacia en una fila no se rechaza aca (la fila puede seguir en edicion)', () => {
      const result = validateFieldValue(field({ validationRules: { columns } }), [
        { producto_id: '', cantidad: 2, subtotal: 200 }
      ])
      expect(result.valid).toBe(true)
    })

    it('columnas que no son de tipo relation nunca se validan como uuid', () => {
      const result = validateFieldValue(field({ validationRules: { columns } }), [
        { producto_id: '11111111-1111-1111-1111-111111111111', cantidad: 'dos', subtotal: 'no-numero' }
      ])
      expect(result.valid).toBe(true)
    })

    it('sin columns en validationRules, cualquier fila pasa (nada que validar)', () => {
      const result = validateFieldValue(field({ validationRules: {} }), [{ cualquier_cosa: 'x' }])
      expect(result.valid).toBe(true)
    })
  })

  describe('otros tipos (cobertura base)', () => {
    it('text: requerido y vacio es invalido', () => {
      const result = validateFieldValue(field({ dataType: 'text', label: 'Nombre', isRequired: true }), '')
      expect(result.valid).toBe(false)
    })

    it('number: no numerico es invalido', () => {
      const result = validateFieldValue(field({ dataType: 'number', label: 'Edad' }), 'abc')
      expect(result.valid).toBe(false)
    })

    it('relation: exige forma de uuid', () => {
      const result = validateFieldValue(field({ dataType: 'relation', label: 'Cliente' }), 'no-es-uuid')
      expect(result.valid).toBe(false)
    })
  })
})
