import { getLicenseStatus, IS_ONPREM_BUILD } from '~/server/utils/license'

const ALLOWED_API_PATHS = new Set(['/api/license/status', '/api/license/activate', '/api/health', '/api/config'])

export default defineEventHandler((event) => {
  if (!IS_ONPREM_BUILD) return
  const url = getRequestURL(event)
  const path = url.pathname
  if (path === '/activar' || path.startsWith('/_nuxt/') || path.startsWith('/brand/') || path === '/favicon.ico' || path === '/robots.txt' || ALLOWED_API_PATHS.has(path)) return

  const status = getLicenseStatus()
  if (status.activated) return
  if (path.startsWith('/api/')) {
    throw createError({ statusCode: 423, statusMessage: 'Instalación sin licencia activa' })
  }
  return sendRedirect(event, `/activar?redirect=${encodeURIComponent(path + url.search)}`, 302)
})
