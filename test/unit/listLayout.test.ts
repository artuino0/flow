import { describe, it, expect } from 'vitest'
import { defaultListLayout, resolveListLayout } from '../../server/utils/listLayout'

// HU-ERD-75: cobertura unitaria de las funciones puras de listLayout.ts
// (defaultListLayout/resolveListLayout), mismo criterio que
// test/unit/detailLayout.test.ts (HU-ERD-74).

describe('defaultListLayout', () => {
  it('todas las columnas visibles en el orden recibido, todos los filtrables ofrecidos, sin orden por defecto', () => {
    const layout = defaultListLayout(['email', 'estado'], ['estado'])
    expect(layout).toEqual({
      columns: [
        { name: 'email', visible: true },
        { name: 'estado', visible: true }
      ],
      filterFields: ['estado'],
      defaultSort: null
    })
  })

  it('sin campos ni filtrables, devuelve arrays vacios y sin orden por defecto (no rompe)', () => {
    expect(defaultListLayout([], [])).toEqual({ columns: [], filterFields: [], defaultSort: null })
  })
})

describe('resolveListLayout', () => {
  const fieldNames = ['email', 'empresa', 'estado', 'etiquetas']
  const filterableFieldNames = ['estado', 'etiquetas']

  it('sin layout guardado (null), cae al default (AC: sin config propia se comporta como antes de la HU)', () => {
    const result = resolveListLayout(null, fieldNames, filterableFieldNames)
    expect(result).toEqual(defaultListLayout(fieldNames, filterableFieldNames))
  })

  it('con un layout guardado que no matchea el schema (forma invalida), cae al default (no rompe)', () => {
    const result = resolveListLayout({ columnas: 'esto no es el schema' }, fieldNames, filterableFieldNames)
    expect(result).toEqual(defaultListLayout(fieldNames, filterableFieldNames))
  })

  it('un layout valido se respeta tal cual (orden, visibilidad, filtros y orden por defecto)', () => {
    const saved = {
      columns: [
        { name: 'estado', visible: true },
        { name: 'email', visible: false },
        { name: 'empresa', visible: true },
        { name: 'etiquetas', visible: true }
      ],
      filterFields: ['estado'],
      defaultSort: { field: 'empresa', dir: 'asc' as const }
    }
    expect(resolveListLayout(saved, fieldNames, filterableFieldNames)).toEqual(saved)
  })

  it('una columna borrada desde que se guardo el layout se descarta silenciosamente', () => {
    const saved = {
      columns: [
        { name: 'email', visible: true },
        { name: 'campo-borrado', visible: true },
        { name: 'empresa', visible: true },
        { name: 'estado', visible: true },
        { name: 'etiquetas', visible: true }
      ],
      filterFields: [],
      defaultSort: null
    }
    const result = resolveListLayout(saved, fieldNames, filterableFieldNames)
    expect(result.columns.map((c) => c.name)).toEqual(['email', 'empresa', 'estado', 'etiquetas'])
  })

  it('una columna nueva (agregada despues de guardar el layout) se suma al final como visible', () => {
    const saved = { columns: [{ name: 'email', visible: false }], filterFields: [], defaultSort: null }
    const result = resolveListLayout(saved, fieldNames, filterableFieldNames)
    expect(result.columns).toEqual([
      { name: 'email', visible: false },
      { name: 'empresa', visible: true },
      { name: 'estado', visible: true },
      { name: 'etiquetas', visible: true }
    ])
  })

  it('filterFields nunca excede el conjunto real de campos filtrables (AC explicito de la HU) - se descarta lo que ya no es Select/Multiselect real', () => {
    const saved = { columns: [], filterFields: ['estado', 'campo-que-dejo-de-ser-select', 'empresa'], defaultSort: null }
    const result = resolveListLayout(saved, fieldNames, filterableFieldNames)
    expect(result.filterFields).toEqual(['estado'])
  })

  it('a diferencia de columnas y propiedades, un campo Select/Multiselect NUEVO no se agrega solo a filterFields (lista curada, no un default expansivo)', () => {
    const saved = { columns: [], filterFields: ['estado'], defaultSort: null }
    const result = resolveListLayout(saved, fieldNames, filterableFieldNames)
    expect(result.filterFields).toEqual(['estado'])
    expect(result.filterFields).not.toContain('etiquetas')
  })

  it('un orden por defecto que referencia un campo borrado se descarta (vuelve a null, no rompe)', () => {
    const saved = { columns: [], filterFields: [], defaultSort: { field: 'campo-borrado', dir: 'desc' as const } }
    expect(resolveListLayout(saved, fieldNames, filterableFieldNames).defaultSort).toBeNull()
  })

  it('un orden por defecto null guardado explicitamente se preserva (sin orden por defecto propio)', () => {
    const saved = { columns: [], filterFields: [], defaultSort: null }
    expect(resolveListLayout(saved, fieldNames, filterableFieldNames).defaultSort).toBeNull()
  })
})
