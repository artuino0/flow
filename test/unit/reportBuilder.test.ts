import { describe, expect, it } from 'vitest'
import { buildPrintReportResult, printReportDslSchema } from '../../server/utils/printReport'

const source = { side: 'base', forwardHops: ['finca'], field: 'hectareas' }
const definition = { title: 'Fincas', baseEntity: 'recepciones', columns: [{ key: 'ha', kind: 'sumar', label: 'Hectáreas', source }] }
const leaves = [{ key: 'ha', label: 'Hectáreas', kind: 'sumar' as const, inRows: true, inTotals: true, sourceSide: 'base' as const, valueAlias: 'ha', identityAlias: 'owner' }]
describe('operational report builder', () => {
  it('sums related records by identity, not repeated reception rows or distinct values', () => {
    const rows = [
      { __base_id__: 'r1', owner: 'f1', ha: 10 },
      { __base_id__: 'r2', owner: 'f1', ha: 10 },
      { __base_id__: 'r3', owner: 'f2', ha: 10 },
      { __base_id__: 'r4', owner: null, ha: null },
    ]
    const result = buildPrintReportResult(printReportDslSchema.parse(definition), leaves, [], rows)
    expect(result.grandTotals.ha).toBe(20)
    expect(result.ungroupedRows).toHaveLength(4)
  })
  it('keeps different entities with the same display name in separate groups', () => {
    const result = buildPrintReportResult(printReportDslSchema.parse(definition), leaves, ['group_0'], [
      { __base_id__: 'r1', group_0: 'Santa Cruz', group_0_identity: 'f1', owner: 'f1', ha: 10 },
      { __base_id__: 'r2', group_0: 'Santa Cruz', group_0_identity: 'f2', owner: 'f2', ha: 20 },
    ])
    expect(result.groups.map(group => group.subtotals.ha)).toEqual([10, 20])
    expect(result.grandTotals.ha).toBe(30)
  })
  it('summary preserves subtotals without printing individual records', () => {
    const dsl = printReportDslSchema.parse({ ...definition, mode: 'summary' })
    const result = buildPrintReportResult(dsl, leaves, ['group_0'], [{ __base_id__: 'r1', group_0: 'Norte', owner: 'f1', ha: 10 }])
    expect(result.groups[0].rows).toEqual([])
    expect(result.groups[0].subtotals.ha).toBe(10)
    expect(result.grandTotals.ha).toBe(10)
    expect(result.columns.map(column => column.label)).toEqual(['Concepto', 'Hectáreas'])
  })
  it('preserves filters, sorting and presentation when saving a definition', () => {
    const options = { mode: 'summary', filters: [{ source, operator: 'gte', value: '10' }], orderBy: [{ source, direction: 'desc' }] }
    expect(printReportDslSchema.parse({ ...definition, ...options })).toMatchObject(options)
  })
  it('rejects unsupported filter operators and empty filter values', () => {
    for (const filter of [{ source, operator: 'sql', value: 'x' }, { source, operator: 'eq', value: '' }]) {
      expect(printReportDslSchema.safeParse({ ...definition, filters: [filter] }).success).toBe(false)
    }
  })
})
