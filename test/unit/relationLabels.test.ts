import { describe, it, expect } from 'vitest'
import { pickLabelField } from '../../server/utils/relationLabels'

// Bug reportado por el usuario (2026-09-04, viendo un uuid truncado
// "86b28200" en el buscador de un campo relacion en vez de un folio
// legible): pickLabelField() (resuelve el label mostrado server-side en
// listados/detalle, GET /api/records/:entity(:id)) solo consideraba
// dataType 'text', dejando afuera 'incremental' - mismo fix que
// utils/recordLabel.ts (frontend), mismo criterio de tests.

describe('pickLabelField', () => {
  it('elige el primer campo de tipo text', () => {
    const fields = [{ name: 'total', dataType: 'number' }, { name: 'nombre', dataType: 'text' }]
    expect(pickLabelField(fields, null)).toBe('nombre')
  })

  it('elige un campo incremental si no hay ningun campo de tipo text', () => {
    const fields = [{ name: 'folio', dataType: 'incremental' }, { name: 'kilos', dataType: 'number' }]
    expect(pickLabelField(fields, null)).toBe('folio')
  })

  it('sin ningun campo text ni incremental, devuelve null (el llamador cae al id truncado)', () => {
    const fields = [{ name: 'kilos', dataType: 'number' }, { name: 'activo', dataType: 'boolean' }]
    expect(pickLabelField(fields, null)).toBeNull()
  })

  it('respeta el override si sigue siendo un campo text o incremental real', () => {
    const fields = [{ name: 'nombre', dataType: 'text' }, { name: 'folio', dataType: 'incremental' }]
    expect(pickLabelField(fields, 'folio')).toBe('folio')
  })

  it('ignora el override si ya no existe o cambio a un tipo no elegible, y cae a la heuristica automatica', () => {
    const fields = [{ name: 'nombre', dataType: 'text' }, { name: 'edad', dataType: 'number' }]
    expect(pickLabelField(fields, 'borrado')).toBe('nombre')
    expect(pickLabelField(fields, 'edad')).toBe('nombre')
  })
})
