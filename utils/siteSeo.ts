import { z } from 'zod'

const text = (max: number) => z.string().trim().max(max).refine(value => !/[<>\u0000-\u001f]/.test(value), 'Usa texto sin HTML ni caracteres de control')
export const siteSeoSchema = z.object({
  title: text(70).optional(), description: text(180).optional(),
  ogTitle: text(70).optional(), ogDescription: text(180).optional(),
  ogImageAssetId: z.string().uuid().optional(),
  twitterCard: z.enum(['summary', 'summary_large_image']).optional(),
  canonicalPath: z.string().max(220).refine(value => /^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(value), 'Usa una ruta del sitio, sin dominio, query ni fragmento').optional(),
  noindex: z.boolean().optional(), nofollow: z.boolean().optional()
}).strict()
export type SiteSeo = z.infer<typeof siteSeoSchema>
export const siteVerificationSchema = z.object({
  google: z.string().regex(/^[A-Za-z0-9_-]{10,100}$/).optional(),
  bing: z.string().regex(/^[A-Za-z0-9_-]{10,100}$/).optional()
}).strict()
export type SiteVerification = z.infer<typeof siteVerificationSchema>
// Los documentos antiguos se leen sin modificar su JSON ni sus claves internas.
export function editableSiteSeo(value: unknown): SiteSeo {
  if (!value || typeof value !== 'object') return {}
  const output: SiteSeo = {}
  for (const key of Object.keys(siteSeoSchema.shape) as Array<keyof SiteSeo>) {
    const parsed = siteSeoSchema.shape[key].safeParse((value as Record<string, unknown>)[key])
    if (parsed.success && parsed.data !== undefined) Object.assign(output, { [key]: parsed.data })
  }
  return output
}
export function siteCanonicalPath(path: string) { return path === '/' ? '/' : path.replace(/\/+$/, '') }
export function escapeSeo(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))
}
