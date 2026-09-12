import { describe, expect, it } from 'vitest'
import { printReportDslSchema } from '../../server/utils/printReport'
const legacy = { title: 'Recepciones', baseEntity: 'recepciones', columns: [{ key: 'peso', kind: 'sumar', label: 'Peso', source: { side: 'base', field: 'peso' } }] }
describe('saved report paper settings', () => {
  it('accepts existing templates without layout', () => {
    expect(printReportDslSchema.parse(legacy).layout).toBeUndefined()
  })
  it('preserves settings in the saved DSL', () => {
    const layout = { paper: 'letter', orientation: 'landscape', density: 'compact' }
    expect(printReportDslSchema.parse({ ...legacy, layout }).layout).toEqual(layout)
  })
  it('rejects unsupported settings', () => {
    expect(printReportDslSchema.safeParse({ ...legacy, layout: { paper: 'poster', orientation: 'landscape', density: 'compact' } }).success).toBe(false)
  })
})
