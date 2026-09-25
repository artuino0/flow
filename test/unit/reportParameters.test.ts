import { describe, expect, it } from 'vitest'
import { inputsForType, resolveParameterFilters, type ReportParameter } from '../../utils/reportParameters'
import { printReportDslSchema } from '../../server/utils/printReport'
const source = { side: 'base' as const, forwardHops: ['finca', 'productor'], field: 'nombre' }
const parameter = (input: ReportParameter['input'], required = false): ReportParameter => ({ id: 'producer', source, label: 'Productor', input, required })
describe('preguntas al generar reportes', () => {
  it('distingue un booleano falso de un filtro omitido', () => {
    expect(resolveParameterFilters([parameter('checkbox')], {})).toEqual([])
    expect(resolveParameterFilters([parameter('checkbox')], { producer: { value: 'false' } })[0]).toMatchObject({ value: 'false', operator: 'eq' })
    expect(resolveParameterFilters([parameter('toggle', true)], { producer: { value: 'false' } })).toHaveLength(1)
  })
  it('exige los obligatorios y rechaza booleanos arbitrarios', () => {
    expect(() => resolveParameterFilters([parameter('text', true)], {})).toThrow('Completa')
    expect(() => resolveParameterFilters([parameter('checkbox')], { producer: { value: 'no' } })).toThrow('Sí o No')
  })
  it('usa la identidad para distinguir productores con igual nombre', () => {
    expect(resolveParameterFilters([parameter('select')], { producer: { value: 'a-record-id', recordId: true } })[0]).toMatchObject({ source, recordId: true, operator: 'eq' })
    expect(resolveParameterFilters([parameter('text')], { producer: { value: 'Vega', recordId: true } })[0]).toMatchObject({ recordId: false, operator: 'contains' })
  })
  it('resuelve rangos inclusivos y comparaciones estrictas', () => {
    expect(resolveParameterFilters([parameter('dateRange')], { producer: { value: '2026-08-18', end: '2026-08-21' } }).map(filter => filter.operator)).toEqual(['gte', 'lte'])
    expect(resolveParameterFilters([parameter('date')], { producer: { value: '2026-08-18', operator: 'lt' } })[0]?.operator).toBe('lt')
    expect(resolveParameterFilters([parameter('numberRange')], { producer: { value: '2', end: '10' } })).toHaveLength(2)
  })
  it('rechaza fechas inexistentes y rangos incompletos o invertidos', () => {
    expect(() => resolveParameterFilters([parameter('date')], { producer: { value: '2026-02-30' } })).toThrow('fecha inválida')
    expect(() => resolveParameterFilters([parameter('dateRange')], { producer: { value: '2026-08-18' } })).toThrow('ambos extremos')
    expect(() => resolveParameterFilters([parameter('numberRange')], { producer: { value: '10', end: '2' } })).toThrow('inicio')
  })
  it('solo ofrece controles compatibles y no modifica las preguntas al ejecutar', () => {
    expect(inputsForType('boolean').map(input => input.value)).toEqual(['checkbox', 'toggle'])
    // Un folio se elige de una lista con buscador (conserva los ceros); lo numérico sigue disponible.
    expect(inputsForType('incremental').map(input => input.value)).toEqual(['select', 'number', 'numberRange'])
    expect(inputsForType('number').map(input => input.value)).toEqual(['number', 'numberRange'])
    const items = [parameter('text')]
    const original = structuredClone(items)
    resolveParameterFilters(items, { producer: { value: 'Vega' } })
    expect(items).toEqual(original)
  })
  it('guarda preguntas sin valores y rechaza identificadores duplicados', () => {
    const dsl = { title: 'Reporte', baseEntity: 'recepciones', includeDeletedBase: false, groupBy: [], columns: [{ kind: 'detalle', key: 'name', label: 'Nombre', source }], parameters: [parameter('select')] }
    expect(printReportDslSchema.safeParse(dsl).success).toBe(true)
    expect(printReportDslSchema.safeParse({ ...dsl, parameters: [parameter('select'), parameter('text')] }).success).toBe(false)
    expect(printReportDslSchema.safeParse({ ...dsl, parameters: [{ ...parameter('select'), value: 'fijo' }] }).success).toBe(false)
  })
})
