import { describe, expect, it } from 'vitest'
import { paginateReportRows, paperDimensions, resolvePrintLayout } from '../../utils/printLayout'

describe('physical report pages', () => {
  it('uses Letter for old reports and chooses landscape for wide tables', () => {
    expect(paperDimensions(resolvePrintLayout())).toEqual({ width: 215.9, height: 279.4 })
    expect(resolvePrintLayout(undefined, 10).orientation).toBe('landscape')
    expect(paperDimensions(resolvePrintLayout({ paper: 'a4', orientation: 'landscape' }))).toEqual({ width: 297, height: 210 })
  })
  it('keeps wrapped rows and nested headings together without losing data', () => {
    const pages = paginateReportRows([30, 15, 15, 40, 20], [false, true, true, false, false], 85)
    expect(pages).toEqual([[0], [1, 2, 3], [4]])
    expect(pages.flat()).toEqual([0, 1, 2, 3, 4])
  })
  it('accounts for fractional heights and has no trailing blank page', () => {
    expect(paginateReportRows([20.4, 20.4, 20.4], [], 60)).toEqual([[0, 1], [2]])
    expect(paginateReportRows([30, 30], [], 60)).toEqual([[0, 1]])
    expect(paginateReportRows([], [], 60)).toEqual([[]])
  })
  it('always terminates for an oversized row', () => {
    expect(paginateReportRows([200, 20], [], 100)).toEqual([[0], [1]])
  })
  it('repeats the active group on continuation pages and keeps totals with detail', () => {
    expect(paginateReportRows([10, 30, 30, 15], [true, false, false, false], 60, [0, -1, -1, -1], [false, false, false, true])).toEqual([[0, 1], [0, 2, 3]])
  })
})
