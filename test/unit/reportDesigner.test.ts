import { describe, expect, it } from 'vitest'
import { moveReportColumn, readReportFieldDrop } from '../../utils/reportDesigner'
describe('report designer drag and drop', () => {
  it('moves columns without losing their aggregation or source', () => {
    const columns = [{ key: 'folio', kind: 'detalle' }, { key: 'peso', kind: 'sumar' }, { key: 'fecha', kind: 'detalle' }]
    expect(moveReportColumn(columns, 'peso', 0).map(column => column.key)).toEqual(['peso', 'folio', 'fecha'])
    expect(moveReportColumn(columns, 'peso', 0)[0]).toBe(columns[1])
    expect(columns[0].key).toBe('folio')
    expect(moveReportColumn(columns, 'folio', -1)).toBe(columns)
  })
  it('ignores unrelated or malformed drag payloads', () => {
    for (const raw of ['{}', 'null', 'bad json', '{"side":"other"}']) expect(readReportFieldDrop(raw)).toBeNull()
    const field = { side: 'base', forwardHops: ['productor'], field: 'nombre', label: 'Productor', dataType: 'text' }
    expect(readReportFieldDrop(JSON.stringify(field))).toEqual(field)
  })
})
