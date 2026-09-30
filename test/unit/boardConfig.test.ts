import { describe, expect, it } from 'vitest'
import { EMPTY_BOARD_CONFIG, resolveBoardConfig } from '../../server/utils/boardConfig'

const fields = [
  { name: 'estado', dataType: 'select' },
  { name: 'nombre', dataType: 'text' },
  { name: 'correo', dataType: 'email' }
]

describe('resolveBoardConfig', () => {
  it('keeps a valid board configuration and reconciles secondary fields', () => {
    expect(resolveBoardConfig({
      enabled: true,
      statusField: 'estado',
      titleField: 'nombre',
      secondaryFields: ['correo', 'eliminado'],
      defaultView: 'board'
    }, fields)).toEqual({
      enabled: true,
      statusField: 'estado',
      titleField: 'nombre',
      secondaryFields: ['correo'],
      defaultView: 'board'
    })
  })

  it('disables the board when the status field is removed or changes type', () => {
    expect(resolveBoardConfig({
      enabled: true,
      statusField: 'nombre',
      titleField: 'nombre',
      secondaryFields: [],
      defaultView: 'board'
    }, fields)).toEqual({ ...EMPTY_BOARD_CONFIG, titleField: 'nombre' })
  })

  it('desactivar Kanban conserva su configuración y deja la vista de Tabla como opción inicial', () => {
    expect(resolveBoardConfig({
      enabled: false,
      statusField: 'estado',
      titleField: 'nombre',
      secondaryFields: ['correo'],
      defaultView: 'table'
    }, fields)).toEqual({
      enabled: false,
      statusField: 'estado',
      titleField: 'nombre',
      secondaryFields: ['correo'],
      defaultView: 'table'
    })
  })

  it('falls back safely for legacy modules without configuration', () => {
    expect(resolveBoardConfig(null, fields)).toEqual(EMPTY_BOARD_CONFIG)
  })
})
