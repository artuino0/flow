export function realtimeRefreshRequiresSession(error: unknown): boolean {
  const statusCode = (error as { statusCode?: number; status?: number } | null)?.statusCode
    ?? (error as { status?: number } | null)?.status
  return statusCode === 401 || statusCode === 403
}

export function realtimeReconnectDelay(attempt: number, random = Math.random()): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5))
  return Math.min(30_000, Math.round(base * (0.8 + random * 0.4)))
}

export function shouldConnectRealtime(stopped: boolean, sessionRequired: boolean): boolean {
  return !stopped && !sessionRequired
}
