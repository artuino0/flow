export function classifyObservabilityError(error: unknown): 'warning' | 'error' {
  const statusCode = (error as { statusCode?: number } | null)?.statusCode
  return typeof statusCode === 'number' && statusCode < 500 ? 'warning' : 'error'
}
