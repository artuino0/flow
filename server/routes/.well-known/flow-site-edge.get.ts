import { createError, defineEventHandler, getQuery, setResponseHeader } from 'h3'
import { effectiveRequestHostname, isTrustedCloudflareRequest } from '~/server/utils/effectiveHost'

export default defineEventHandler(event => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const nonce = getQuery(event).nonce
  if (!isTrustedCloudflareRequest(event) || typeof nonce !== 'string' || !/^[a-f0-9-]{36}$/.test(nonce)) {
    throw createError({ statusCode: 404, statusMessage: 'No disponible.' })
  }
  // Prueba pública del recorrido de borde; no devuelve secreto, cookies ni datos de sitios.
  return { edge: true, hostname: effectiveRequestHostname(event), nonce }
})
