import type { Blueprint } from '~/server/utils/blueprint/schema'

const executable = /<[^>]+>|\bjavascript:|\bdata:text\/html|https?:\/\/|\b(?:SELECT\b.{1,200}\bFROM\b|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE|TRUNCATE\s+TABLE)|\bfunction\s+\w+\s*\(|=>|```/i

export function trustedBlueprintStrings(blueprint: Blueprint) {
  const trusted = new Set<string>()
  const visit = (value: unknown): void => {
    if (typeof value === 'string') trusted.add(value)
    else if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(blueprint)
  return trusted
}

export function containsUnsafeBlueprintText(value: unknown, trusted: Set<string>): boolean {
  if (typeof value === 'string') return !trusted.has(value) && (value.length > 4000 || executable.test(value))
  if (Array.isArray(value)) return value.some(item => containsUnsafeBlueprintText(item, trusted))
  if (value && typeof value === 'object') return Object.values(value).some(item => containsUnsafeBlueprintText(item, trusted))
  return false
}
