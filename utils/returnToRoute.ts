export const IDLE_RETURN_KEY = 'flow-idle-return'

export interface IdleReturn { path: string; userId: string; tenantId: string }

export function safeInternalRoute(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  try {
    const url = new URL(value, 'https://flow.local')
    if (url.origin !== 'https://flow.local') return null
    const path = url.pathname.toLowerCase()
    if (['/login', '/registro', '/logout'].some(blocked => path === blocked || path.startsWith(`${blocked}/`))) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch { return null }
}

export function postLoginRoute(queryRedirect: unknown, saved: IdleReturn | null, user: { id: string; tenantId: string } | null, idleLogout: boolean): string {
  const path = safeInternalRoute(queryRedirect) ?? safeInternalRoute(saved?.path)
  if (!path) return '/'
  if (idleLogout || saved) {
    if (!saved || !user || saved.userId !== user.id || saved.tenantId !== user.tenantId || saved.path !== path) return '/'
  }
  return path
}
