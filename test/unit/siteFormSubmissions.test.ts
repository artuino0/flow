import { describe, expect, it } from 'vitest'
import { mapSiteFormPayload } from '../../server/utils/siteFormSubmissions'

const fields = [
  { id: '1', name: 'nombre', dataType: 'text', validationRules: null, isRequired: true },
  { id: '2', name: 'empleados', dataType: 'number', validationRules: null, isRequired: false },
  { id: '3', name: 'acepta_contacto', dataType: 'boolean', validationRules: null, isRequired: false },
  { id: '4', name: 'servicios', dataType: 'multiselect', validationRules: null, isRequired: false },
  { id: '5', name: 'folio', dataType: 'incremental', validationRules: null, isRequired: false }
]

describe('mapSiteFormPayload', () => {
  it('convierte valores según el tipo del campo de Flow Core', () => {
    const result = mapSiteFormPayload({
      nombre_completo: 'Jessica Barrón',
      cantidad: '12',
      permiso: 'on',
      interes: ['Contabilidad', 'Nómina']
    }, {
      nombre_completo: 'nombre',
      cantidad: 'empleados',
      permiso: 'acepta_contacto',
      interes: 'servicios'
    }, fields)

    expect(result.customData).toEqual({
      nombre: 'Jessica Barrón',
      empleados: 12,
      acepta_contacto: true,
      servicios: ['Contabilidad', 'Nómina']
    })
    expect(result.appliedMapping).toEqual({
      nombre_completo: 'nombre',
      cantidad: 'empleados',
      permiso: 'acepta_contacto',
      interes: 'servicios'
    })
  })

  it('solo guarda coincidencias exactas cuando no hay mapeo configurado', () => {
    const result = mapSiteFormPayload({
      nombre: 'Arturo',
      desconocido: 'No debe guardarse',
      folio: 'Intento de sobrescribir el consecutivo'
    }, {}, fields)

    expect(result.customData).toEqual({ nombre: 'Arturo' })
    expect(result.appliedMapping).toEqual({ nombre: 'nombre' })
  })

  it('aplica valores predeterminados de la conexión y prevalecen sobre el formulario', () => {
    const result = mapSiteFormPayload({
      nombre: 'Arturo',
      permiso: 'false'
    }, {
      nombre: 'nombre',
      permiso: 'acepta_contacto'
    }, fields, {
      acepta_contacto: true,
      empleados: 4
    })

    expect(result.customData).toEqual({
      nombre: 'Arturo',
      acepta_contacto: true,
      empleados: 4
    })
    expect(result.appliedDefaults).toEqual({
      acepta_contacto: true,
      empleados: 4
    })
  })

  it('traduce valores externos antes de validar el campo de destino', () => {
    const result = mapSiteFormPayload({
      interes: ['contabilidad', 'planeacion']
    }, {
      interes: 'servicios'
    }, fields, {}, {
      interes: {
        contabilidad: 'contabilidad_mensual',
        planeacion: 'planeacion_fiscal'
      }
    })

    expect(result.customData).toEqual({
      servicios: ['contabilidad_mensual', 'planeacion_fiscal']
    })
  })
})
