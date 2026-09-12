export interface PrintLayout {
  paper: 'letter' | 'a4'
  orientation: 'portrait' | 'landscape'
  density: 'normal' | 'compact'
}
export function resolvePrintLayout(layout?: Partial<PrintLayout>, columns = 0): PrintLayout {
  return { paper: layout?.paper ?? 'letter', orientation: layout?.orientation ?? (columns > 7 ? 'landscape' : 'portrait'), density: layout?.density ?? 'normal' }
}
export function paperDimensions(layout: PrintLayout) {
  const [short, long] = layout.paper === 'a4' ? [210, 297] : [215.9, 279.4]
  return layout.orientation === 'landscape' ? { width: long, height: short } : { width: short, height: long }
}
/** Measured heights preserve wrapped text. Keep group headings with their next row. */
export function paginateReportRows(heights: number[], headings: boolean[], capacity: number, levels?: number[], summaries: boolean[] = []): number[][] {
  if (!heights.length) return [[]]
  const pages: number[][] = []
  const active: number[] = []
  let page: number[] = [], used = 0
  for (let i = 0; i < heights.length;) {
    // A unit contains its heading chain, one detail and any following subtotals.
    const unit: number[] = [i++]
    while (headings[unit[unit.length - 1]!] && i < heights.length) unit.push(i++)
    while (summaries[i] && i < heights.length) unit.push(i++)
    const required = unit.reduce((sum, index) => sum + heights[index]!, 0)
    if (page.length && used + required > capacity) {
      pages.push(page)
      const first = unit[0]!
      page = levels ? active.filter(index => !headings[first] || levels[index]! < levels[first]!) : []
      used = page.reduce((sum, index) => sum + heights[index]!, 0)
    }
    for (const index of unit) {
      if (headings[index] && levels) {
        while (active.length && levels[active[active.length - 1]!]! >= levels[index]!) active.pop()
        active.push(index)
      }
      page.push(index)
    }
    used += required
  }
  if (page.length) pages.push(page)
  return pages
}
