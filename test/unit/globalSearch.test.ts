import { describe, expect, it } from 'vitest'
import { normalizeSearch, searchHistory, searchPattern } from '../../utils/globalSearch'

describe('global search', () => {
  it('normalizes accents and casing for folios and names', () => {
    expect(normalizeSearch('  AGRÍCOLA Muñoz  ')).toBe('agricola munoz')
  })
  it('treats SQL wildcards as literal input', () => {
    expect(searchPattern('50%_\\')).toBe('%50\\%\\_\\\\%')
  })
  it('never restores record data or URLs from browser history', () => {
    const id = '12345678-1234-1234-1234-123456789012'
    expect(searchHistory([id, id, '/admin', { title: 'Secret' }, '<script>'])).toEqual([id])
    expect(searchHistory(null)).toEqual([])
  })
})
