import { z } from 'zod'
import { effectiveRequestURL } from '~/server/utils/effectiveHost'
import { randomBytes } from 'node:crypto'
import { defineEventHandler, getRouterParam, setResponseHeader, setResponseStatus } from 'h3'
import type { AgendaRuntimeConfig } from '~/utils/publicAgendaRuntime'
import { renderAgendaManagementDocument } from '~/server/utils/agendaManagementDocument'
import { publicAgendaPresentation, resolveAgendaContext } from '~/server/utils/agendaPublic'
export default defineEventHandler(async event => {
  setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  const parsed = z.object({ site: z.string().uuid(), page: z.string().uuid() }).safeParse({ site: getRouterParam(event, 'site'), page: getRouterParam(event, 'page') })
  let config: AgendaRuntimeConfig = { site: '', page: '', timezone: 'UTC', locale: 'es', accent: 'rgb(0 110 132)', unavailable: true }
  if (parsed.success) {
    const { site, page } = parsed.data
    const url = effectiveRequestURL(event), host = url.host
    try {
      const context = await resolveAgendaContext(site, page, { origin: `${url.protocol}//${host}`, host, ip: '', userAgent: '' })
      config = (await publicAgendaPresentation(context, 'es')).runtime
    } catch (error) { if ((error as { statusCode?: number }).statusCode !== 404) throw error }
  }
  if (config.unavailable) setResponseStatus(event, 404)
  const nonce = randomBytes(24).toString('base64')
  setResponseHeader(event, 'Content-Security-Policy', `script-src 'nonce-${nonce}'; script-src-attr 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`)
  return renderAgendaManagementDocument(config).replace('<script data-flow-agenda-runtime>', `<script data-flow-agenda-runtime nonce="${nonce}">`)
})
