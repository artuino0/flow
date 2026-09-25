import { describe, it, expect } from 'vitest'
import { defaultDetailLayout, resolveDetailLayout, type InverseRelation } from '../../server/utils/detailLayout'

// HU-ERD-74: cobertura unitaria de las funciones puras de detailLayout.ts
// (defaultDetailLayout/resolveDetailLayout). computeInverseRelations() no se
// cubre aca porque depende de una transaccion Drizzle real - queda cubierta a
// nivel e2e (test/e2e/crudEntities.test.ts, describe HU-ERD-74).

function inv(overrides: Partial<InverseRelation> = {}): InverseRelation {
  return { entitySlug: 'facturas', entityName: 'Facturas', fieldName: 'cotizacion_id', fieldLabel: 'Cotización', ...overrides }
}

describe('defaultDetailLayout', () => {
  it('incluye todas las propiedades y relaciones, todas visibles, en el orden recibido', () => {
    const layout = defaultDetailLayout(['email', 'empresa'], [inv()])
    expect(layout).toEqual({
      properties: [
        { name: 'email', visible: true },
        { name: 'empresa', visible: true }
      ],
      relations: [{ entitySlug: 'facturas', fieldName: 'cotizacion_id', visible: true }],
      showActivity: false
    })
  })

  it('sin campos ni relaciones inversas, devuelve arrays vacios (no rompe)', () => {
    expect(defaultDetailLayout([], [])).toEqual({ properties: [], relations: [], showActivity: false })
  })
})

describe('resolveDetailLayout', () => {
  const fieldNames = ['email', 'empresa', 'estado']
  const relations = [inv(), inv({ entitySlug: 'pedidos', fieldName: 'cliente_id', entityName: 'Pedidos', fieldLabel: 'Cliente' })]

  it('sin layout guardado (null), cae al default (AC: "no queda vacía")', () => {
    const result = resolveDetailLayout(null, fieldNames, relations)
    expect(result).toEqual(defaultDetailLayout(fieldNames, relations))
  })

  it('con un layout guardado que no matchea el schema (forma invalida), cae al default (AC: "no rompe")', () => {
    const result = resolveDetailLayout({ propiedades: 'esto no es el schema' }, fieldNames, relations)
    expect(result).toEqual(defaultDetailLayout(fieldNames, relations))
  })

  it('un layout valido se respeta tal cual (orden y visibilidad)', () => {
    const saved = {
      properties: [
        { name: 'estado', visible: true },
        { name: 'email', visible: false },
        { name: 'empresa', visible: true }
      ],
      relations: [
        { entitySlug: 'facturas', fieldName: 'cotizacion_id', visible: false },
        { entitySlug: 'pedidos', fieldName: 'cliente_id', visible: true }
      ],
      showActivity: true
    }
    const result = resolveDetailLayout(saved, fieldNames, relations)
    expect(result).toEqual(saved)
  })

  it('un campo borrado desde que se guardo el layout se descarta silenciosamente', () => {
    const saved = {
      properties: [
        { name: 'email', visible: true },
        { name: 'campo-borrado', visible: true },
        { name: 'empresa', visible: true },
        { name: 'estado', visible: true }
      ],
      relations: [],
      showActivity: false
    }
    const result = resolveDetailLayout(saved, fieldNames, [])
    expect(result.properties.map((p) => p.name)).toEqual(['email', 'empresa', 'estado'])
  })

  it('un campo nuevo (agregado despues de guardar el layout) se suma al final como visible', () => {
    const saved = {
      properties: [{ name: 'email', visible: false }],
      relations: [],
      showActivity: false
    }
    const result = resolveDetailLayout(saved, fieldNames, [])
    expect(result.properties).toEqual([
      { name: 'email', visible: false },
      { name: 'empresa', visible: true },
      { name: 'estado', visible: true }
    ])
  })

  it('una relacion inversa que ya no existe (campo relation borrado o relationEntity cambiado) se descarta', () => {
    const saved = {
      properties: fieldNames.map((name) => ({ name, visible: true })),
      relations: [{ entitySlug: 'facturas', fieldName: 'campo-que-ya-no-apunta-aca', visible: true }],
      showActivity: false
    }
    const result = resolveDetailLayout(saved, fieldNames, relations)
    expect(result.relations.map((r) => r.fieldName)).toEqual(['cotizacion_id', 'cliente_id'])
  })

  it('una relacion inversa nueva se suma al final como visible', () => {
    const saved = {
      properties: fieldNames.map((name) => ({ name, visible: true })),
      relations: [{ entitySlug: 'facturas', fieldName: 'cotizacion_id', visible: false }],
      showActivity: false
    }
    const result = resolveDetailLayout(saved, fieldNames, relations)
    expect(result.relations).toEqual([
      { entitySlug: 'facturas', fieldName: 'cotizacion_id', visible: false },
      { entitySlug: 'pedidos', fieldName: 'cliente_id', visible: true }
    ])
  })

  it('showActivity guardado se preserva tal cual (true o false)', () => {
    const saved = { properties: [], relations: [], showActivity: true }
    expect(resolveDetailLayout(saved, [], []).showActivity).toBe(true)
  })
})

describe('relaciones editables (líneas)', () => {
  const inverse: InverseRelation[] = [{ entitySlug: 'partidas', entityName: 'Partidas', fieldName: 'pedido', fieldLabel: 'Pedido' }]

  it('conserva editable y totals guardados al resolver el layout', () => {
    const saved = { properties: [], relations: [{ entitySlug: 'partidas', fieldName: 'pedido', visible: true, editable: true, totals: ['importe'] }], showActivity: false }
    expect(resolveDetailLayout(saved, [], inverse).relations[0]).toMatchObject({ editable: true, totals: ['importe'] })
  })

  it('un layout guardado sin editable sigue siendo válido (solo lectura)', () => {
    const saved = { properties: [], relations: [{ entitySlug: 'partidas', fieldName: 'pedido', visible: true }], showActivity: false }
    expect(resolveDetailLayout(saved, [], inverse).relations[0]!.editable).toBeUndefined()
  })
})
