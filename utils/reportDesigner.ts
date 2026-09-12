export function moveReportColumn<T extends { key: string }>(columns: T[], key: string, target: number): T[] {
  const index = columns.findIndex(column => column.key === key)
  if (index < 0 || target < 0 || target >= columns.length || index === target) return columns
  const result = [...columns]
  const [column] = result.splice(index, 1)
  result.splice(target, 0, column!)
  return result
}

export function readReportFieldDrop(raw: string) {
  try {
    const value = JSON.parse(raw)
    if (!value || !['base', 'detail'].includes(value.side) || !Array.isArray(value.forwardHops) || value.forwardHops.length > 3 || !value.forwardHops.every((hop: unknown) => typeof hop === 'string' && hop.length > 0)) return null
    if (!['field', 'label', 'dataType'].every(key => typeof value[key] === 'string' && value[key].length > 0)) return null
    return value as { side: 'base' | 'detail'; forwardHops: string[]; field: string; label: string; dataType: string }
  } catch { return null }
}
