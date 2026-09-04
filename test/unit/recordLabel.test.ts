import { describe, it, expect } from 'vitest'
import { labelFieldFor, labelForRecord } from '../../utils/recordLabel'
import type { EntityFieldMeta } from '../../composables/useEntityFields'

// Reportado por el usuario (2026-09-03): cobertura unitaria de
// utils/recordLabel.ts - el filtro `name !== 'id'` (regresion auto-detectada
// al agregar el campo sintetico "id" en fields.get.ts, ver comentario largo
// alla) y el override explicito de entities.labelField (ver comentario largo
// en server/db/schema.ts).

function field(overrides: Partial<EntityFieldMeta> & Pick<EntityFieldMeta, 'name' | 'dataType'>): EntityFieldMeta {
  return { id: overrides.name, label: overrides.name, validationRules: {}, isRequired: false, ...overrides }
}

describe('labelFieldFor', () => {
  it('elige el primer campo de tipo text, ignorando el sintetico "id"', () => {
    const fields = [field({ name: 'id', dataType: 'text' }), field({ name: 'total', dataType: 'number' }), field({ name: 'nombre', dataType: 'text' })]
    expect(labelFieldFor(fields)).toBe('nombre')
  })

  it('sin ningun campo de texto (aparte de "id"), devuelve null', () => {
    const fields = [field({ name: 'id', dataType: 'text' }), field({ name: 'total', dataType: 'number' })]
    expect(labelFieldFor(fields)).toBeNull()
  })

  it('respeta el override si sigue siendo un campo de texto real', () => {
    const fields = [field({ name: 'nombre', dataType: 'text' }), field({ name: 'telefono', dataType: 'text' })]
    expect(labelFieldFor(fields, 'telefono')).toBe('telefono')
  })

  it('ignora el override si ya no existe o cambio de tipo, y cae a la heuristica automatica', () => {
    const fields = [field({ name: 'nombre', dataType: 'text' }), field({ name: 'edad', dataType: 'number' })]
    expect(labelFieldFor(fields, 'borrado')).toBe('nombre')
    expect(labelFieldFor(fields, 'edad')).toBe('nombre')
  })

  it('nunca respeta un override de "id", aunque se lo pasen a mano', () => {
    const fields = [field({ name: 'id', dataType: 'text' }), field({ name: 'nombre', dataType: 'text' })]
    expect(labelFieldFor(fields, 'id')).toBe('nombre')
  })
})

describe('labelForRecord', () => {
  const fields = [field({ name: 'id', dataType: 'text' }), field({ name: 'nombre', dataType: 'text' }), field({ name: 'telefono', dataType: 'text' })]

  it('usa el valor del campo etiqueta automatico cuando no hay override', () => {
    expect(labelForRecord(fields, { nombre: 'Rancho El Aguacate', telefono: '555-0000' }, 'uuid-1234')).toBe('Rancho El Aguacate')
  })

  it('usa el valor del campo elegido por override cuando esta fijado', () => {
    expect(labelForRecord(fields, { nombre: 'Rancho El Aguacate', telefono: '555-0000' }, 'uuid-1234', 'telefono')).toBe('555-0000')
  })

  it('cae al id truncado si el campo elegido esta vacio', () => {
    expect(labelForRecord(fields, { nombre: '', telefono: '' }, 'uuid12345678')).toBe('uuid1234')
  })
})
