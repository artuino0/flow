export interface SearchResult {
  id: string
  entity: string
  entityName: string
  icon?: string | null
  title: string
  subtitle: string
  url: string
  kind: 'record' | 'command'
}
export interface SearchResponse { results: SearchResult[]; commands: SearchResult[]; hasMore: boolean }
export function normalizeSearch(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}
export function searchPattern(value: string) {
  return `%${normalizeSearch(value).replace(/[\\%_]/g, '\\$&')}%`
}
export function searchHistory(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(item)))].slice(0, 8) : []
}
