import { z } from 'zod'
import { effectiveRequestHostname } from '~/server/utils/effectiveHost'
import { submitSiteForm, type SiteFormPayload } from '~/server/utils/siteFormSubmissions'
import { withSystemRecordAccess } from '~/server/utils/recordActorContext'

const valueSchema = z.union([
  z.string().max(20_000),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(5_000)).max(100)
])
const schema = z.object({
  siteId: z.string().uuid(),
  pageId: z.string().uuid(),
  formKey: z.string().trim().min(1).max(160),
  payload: z.record(valueSchema).refine(value => Object.keys(value).length <= 200, 'Demasiados campos'),
  href: z.string().max(2_048).optional(),
  referrer: z.string().max(2_048).optional()
}).strict()

function originData(event: Parameters<typeof getRequestURL>[0], href?: string, referrer?: string) {
  let url: URL | null = null
  try { if (href) url = new URL(href) } catch { /* URL manipulada: se ignora */ }
  const utm: Record<string, string> = {}
  for (const key of ['source', 'medium', 'campaign', 'term', 'content']) {
    const value = url?.searchParams.get(`utm_${key}`)?.slice(0, 500)
    if (value) utm[key] = value
  }
  return {
    domain: effectiveRequestHostname(event),
    path: url?.pathname || '/',
    referrer: referrer || getHeader(event, 'referer') || null,
    userAgent: getHeader(event, 'user-agent')?.slice(0, 1000) || null,
    utm,
    capturedAt: new Date().toISOString()
  }
}

export default defineEventHandler(async event => {
  const body = await readValidatedBody(event, schema.parse)
  const payload = body.payload as SiteFormPayload
  if (payload._flow_honeypot) return { ok: true }
  const result = await withSystemRecordAccess(() => submitSiteForm({
    siteId: body.siteId,
    pageId: body.pageId,
    formKey: body.formKey,
    payload,
    origin: originData(event, body.href, body.referrer)
  }))
  setResponseStatus(event, 201)
  return { ok: true, ...result }
})
