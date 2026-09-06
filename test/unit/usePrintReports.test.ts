import { describe, it, expect } from 'vitest'
import { collectBaseLeaves, topLevelDetailCandidates, collectDetailLeaves, isNumericFieldType, isPivotableFieldType, type FieldTreeNode, type FieldTreeBranch } from '../../composables/usePrintReports'

// ERD-88: prueba pura (sin Postgres, sin red, sin Nuxt) del aplanado de
// FieldTreeNode que usa el Diseñador de 3 columnas para armar los pickers de
// "Campos disponibles"/"Campo condición" - mismo escenario que
// test/integration/reportFieldPath.test.ts (Recepcion -> Camion -> Linea de
// Transporte, Manifiesto <- Estiba) pero sobre datos ya aplanados a mano en
// vez de contra Postgres real, para poder testear la logica del cliente sola.

const tree: FieldTreeNode[] = [
  { type: 'leaf', fieldName: 'numero', label: 'Número', dataType: 'incremental' },
  { type: 'leaf', fieldName: 'estado', label: 'Estado', dataType: 'select' },
  {
    type: 'branch',
    kind: 'forward',
    fieldName: 'vehiculo',
    entitySlug: 'vehiculos',
    entityName: 'Vehículo',
    cardinality: '1:1',
    children: [
      { type: 'leaf', fieldName: 'placa', label: 'Placa', dataType: 'text' },
      {
        type: 'branch',
        kind: 'forward',
        fieldName: 'linea',
        entitySlug: 'lineas-transporte',
        entityName: 'Línea de Transporte',
        cardinality: '1:1',
        children: [{ type: 'leaf', fieldName: 'razon_social', label: 'Razón social', dataType: 'text' }]
      },
      // Un salto inverso ANIDADO dentro de un forward (ej. algo que apunta a
      // Vehiculo) - ReportPathPlanner no puede resolver esto, debe quedar
      // afuera del aplanado de leaves del lado base.
      {
        type: 'branch',
        kind: 'inverse',
        fieldName: 'vehiculo',
        entitySlug: 'multas',
        entityName: 'Multas',
        cardinality: '1:N',
        children: [{ type: 'leaf', fieldName: 'monto', label: 'Monto', dataType: 'number' }]
      }
    ]
  },
  {
    type: 'branch',
    kind: 'inverse',
    fieldName: 'manifiesto',
    entitySlug: 'estibas',
    entityName: 'Estibas empacadas',
    cardinality: '1:N',
    children: [
      { type: 'leaf', fieldName: 'codigo', label: 'Código', dataType: 'text' },
      { type: 'leaf', fieldName: 'peso', label: 'Peso (kg)', dataType: 'number' },
      { type: 'leaf', fieldName: 'embarcado', label: 'Embarcado', dataType: 'boolean' }
    ]
  }
]

describe('collectBaseLeaves', () => {
  it('incluye hojas directas y las de branches forward anidados, acumulando forwardHops', () => {
    const leaves = collectBaseLeaves(tree)
    expect(leaves.find((l) => l.field === 'numero')).toMatchObject({ forwardHops: [] })
    expect(leaves.find((l) => l.field === 'placa')).toMatchObject({ forwardHops: ['vehiculo'] })
    expect(leaves.find((l) => l.field === 'razon_social')).toMatchObject({ forwardHops: ['vehiculo', 'linea'] })
  })

  it('excluye las hojas de branches inverse (tabla relacionada, no ruta del lado base) incluida una anidada dentro de un forward', () => {
    const leaves = collectBaseLeaves(tree)
    expect(leaves.some((l) => l.field === 'codigo')).toBe(false)
    expect(leaves.some((l) => l.field === 'monto')).toBe(false)
  })
})

describe('topLevelDetailCandidates', () => {
  it('solo devuelve branches inverse de nivel 0, no la anidada dentro de Vehículo', () => {
    const candidates = topLevelDetailCandidates(tree)
    expect(candidates.map((c) => c.entitySlug)).toEqual(['estibas'])
  })
})

describe('collectDetailLeaves', () => {
  it('aplana las hojas de la tabla relacionada elegida', () => {
    const estibas = topLevelDetailCandidates(tree)[0] as FieldTreeBranch
    const leaves = collectDetailLeaves(estibas)
    expect(leaves.map((l) => l.field).sort()).toEqual(['codigo', 'embarcado', 'peso'])
    expect(leaves.every((l) => l.forwardHops.length === 0)).toBe(true)
  })
})

describe('isNumericFieldType / isPivotableFieldType', () => {
  it('number e incremental son numericos; boolean y select son pivotables', () => {
    expect(isNumericFieldType('number')).toBe(true)
    expect(isNumericFieldType('incremental')).toBe(true)
    expect(isNumericFieldType('text')).toBe(false)
    expect(isPivotableFieldType('boolean')).toBe(true)
    expect(isPivotableFieldType('select')).toBe(true)
    expect(isPivotableFieldType('number')).toBe(false)
  })
})
