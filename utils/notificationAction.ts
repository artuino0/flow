const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

/**
 * Las notificaciones internas deben navegar dentro de la instancia que el
 * usuario tiene abierta. También repara filas históricas que guardaron una
 * URL absoluta con localhost antes de usar rutas relativas.
 */
export function resolveNotificationActionUrl(actionUrl: string, currentOrigin?: string): string {
  if (actionUrl.startsWith('/')) return actionUrl
  try {
    const parsed = new URL(actionUrl)
    const current = currentOrigin ? new URL(currentOrigin) : null
    if (LOCAL_HOSTS.has(parsed.hostname) && current && !LOCAL_HOSTS.has(current.hostname)) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`
    }
  } catch {
    return actionUrl
  }
  return actionUrl
}
