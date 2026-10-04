import { and, desc, eq, max } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { entities, entityFields, siteFormConnections, sitePages, sitePageVersions, sites } from '~/server/db/schema'
import { agendaMarkerWarnings, agendaEditorPreviewState } from './agendaMarkerWarnings'

export const SITE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DEFAULT_HOME_HTML = `<main class="flow-site-page"><section class="flow-site-hero"><p class="eyebrow">Bienvenido</p><h1>Una experiencia pública conectada con Flow.</h1><p>Este es el borrador de tu página de inicio. Personaliza su contenido antes de publicarla.</p></section></main>`
const DEFAULT_HOME_CSS = `.flow-site-page { min-height:100%; padding:72px 24px; font-family:Inter,system-ui,sans-serif; color:#16365c; background:#f7fafc; } .flow-site-hero { max-width:720px; margin:0 auto; padding:56px; border-radius:18px; background:#fff; box-shadow:0 12px 35px rgba(26,64,107,.08); } .eyebrow { margin:0 0 12px; color:#0097b2; font-size:12px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; } h1 { margin:0; font-size:42px; line-height:1.08; }`

function pgCode(error: unknown) {
  const value = error as { code?: string; cause?: { code?: string } }
  return value.code ?? value.cause?.code
}
export class DuplicateSiteError extends Error {}

export interface SiteFormField {
  name: string
  label: string
  type: string
  required: boolean
  options?: Array<{ value: string; label: string }>
}

export interface SiteFormManifest {
  id: string
  name: string
  method: string
  action: string
  fields: SiteFormField[]
}

export type SiteFormConnectionValue = string | number | boolean | null | string[]
export type SiteFormValueMappings = Record<string, Record<string, string>>

interface SiteFormTargetField {
  name: string
  label: string
  dataType: string
  validationRules: unknown
  isRequired: boolean
}

function hasConnectionValue(value: SiteFormConnectionValue | undefined) {
  return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0)
}

function normalizeConnectionDefault(field: SiteFormTargetField, value: SiteFormConnectionValue) {
  if (!hasConnectionValue(value)) return null
  if (field.dataType === 'multiselect') {
    const values = Array.isArray(value) ? value : [String(value)]
    const allowed = new Set(((field.validationRules as { options?: Array<{ value?: string }> } | null)?.options ?? [])
      .map(option => option.value)
      .filter((option): option is string => Boolean(option)))
    if (allowed.size && values.some(option => !allowed.has(option))) {
      throw createError({ statusCode: 422, statusMessage: `El valor predeterminado de "${field.label}" no pertenece a sus opciones.` })
    }
    return values
  }
  const scalar = Array.isArray(value) ? value[0] : value
  if (field.dataType === 'boolean') return scalar === true || String(scalar).toLowerCase() === 'true'
  if (field.dataType === 'number' || field.dataType === 'currency') {
    const number = Number(scalar)
    if (!Number.isFinite(number)) {
      throw createError({ statusCode: 422, statusMessage: `El valor predeterminado de "${field.label}" debe ser numérico.` })
    }
    return number
  }
  const text = String(scalar ?? '')
  if (field.dataType === 'select') {
    const allowed = new Set(((field.validationRules as { options?: Array<{ value?: string }> } | null)?.options ?? [])
      .map(option => option.value)
      .filter((option): option is string => Boolean(option)))
    if (allowed.size && !allowed.has(text)) {
      throw createError({ statusCode: 422, statusMessage: `El valor predeterminado de "${field.label}" no pertenece a sus opciones.` })
    }
  }
  return text
}

function attribute(source: string, name: string) {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim()
}

export function extractSiteForms(html: string): SiteFormManifest[] {
  const forms: SiteFormManifest[] = []
  const formPattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi
  let formMatch: RegExpExecArray | null
  let index = 0
  while ((formMatch = formPattern.exec(html))) {
    index += 1
    const attributes = formMatch[1] ?? ''
    const body = formMatch[2] ?? ''
    const id = attribute(attributes, 'data-flow-form') || attribute(attributes, 'id') || `form-${index}`
    const fields: SiteFormField[] = []
    const fieldPattern = /<(input|textarea)\b([^>]*)>|<select\b([^>]*)>([\s\S]*?)<\/select>/gi
    let fieldMatch: RegExpExecArray | null
    while ((fieldMatch = fieldPattern.exec(body))) {
      const tag = fieldMatch[1]?.toLowerCase() ?? 'select'
      const fieldAttributes = fieldMatch[1] ? (fieldMatch[2] ?? '') : (fieldMatch[3] ?? '')
      const name = attribute(fieldAttributes, 'name')
      if (!name) continue
      const inputType = tag === 'input' ? (attribute(fieldAttributes, 'type') || 'text') : tag
      const options: Array<{ value: string; label: string }> = []
      if (tag === 'select') {
        const optionPattern = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi
        let optionMatch: RegExpExecArray | null
        while ((optionMatch = optionPattern.exec(fieldMatch[4] ?? ''))) {
          const optionAttributes = optionMatch[1] ?? ''
          const label = (optionMatch[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
          const hasExplicitValue = /\bvalue\s*=/i.test(optionAttributes)
          const value = hasExplicitValue ? attribute(optionAttributes, 'value') : label
          if (value) options.push({ value, label: label || value })
        }
      }
      fields.push({
        name,
        label: attribute(fieldAttributes, 'aria-label') || attribute(fieldAttributes, 'placeholder') || name,
        type: inputType,
        required: /\brequired(?:\s|=|>|$)/i.test(fieldAttributes),
        ...(options.length ? { options } : {})
      })
    }
    forms.push({
      id,
      name: attribute(attributes, 'data-flow-name') || attribute(attributes, 'name') || `Formulario ${index}`,
      method: (attribute(attributes, 'method') || 'post').toUpperCase(),
      action: attribute(attributes, 'action'),
      fields
    })
  }
  return forms
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]!))
}

export function normalizeSitePath(value: string) {
  const raw = value.trim()
  if (!raw) return '/'
  const path = raw.startsWith('/') ? raw : `/${raw}`
  const normalized = path.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
  if (!/^\/[a-zA-Z0-9/_-]*$/.test(normalized)) throw createError({ statusCode: 422, statusMessage: 'La ruta solo puede incluir letras, números, guiones y barras' })
  return normalized
}

export async function listSites(tenantId: string) {
  return withTenant(tenantId, async tx => {
    const rows = await tx.select().from(sites).where(eq(sites.tenantId, tenantId)).orderBy(desc(sites.updatedAt))
    const pages = rows.length ? await tx.select({ siteId: sitePages.siteId }).from(sitePages).where(eq(sitePages.tenantId, tenantId)) : []
    const manifests = rows.length ? await tx.select({ siteId: sitePages.siteId, manifest: sitePageVersions.formManifest }).from(sitePages)
      .innerJoin(sitePageVersions, eq(sitePageVersions.id, sitePages.draftVersionId))
      .where(eq(sitePages.tenantId, tenantId)) : []
    const countBySite = new Map<string, number>()
    const formsBySite = new Map<string, number>()
    for (const page of pages) countBySite.set(page.siteId, (countBySite.get(page.siteId) ?? 0) + 1)
    for (const row of manifests) formsBySite.set(row.siteId, (formsBySite.get(row.siteId) ?? 0) + (Array.isArray(row.manifest) ? row.manifest.length : 0))
    return rows.map(site => ({ ...site, pageCount: countBySite.get(site.id) ?? 0, formCount: formsBySite.get(site.id) ?? 0 }))
  })
}

export async function getSite(tenantId: string, siteId: string) {
  return withTenant(tenantId, async tx => {
    const [site] = await tx.select().from(sites).where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId))).limit(1)
    if (!site) return null
    const pages = await tx.select().from(sitePages).where(and(eq(sitePages.siteId, siteId), eq(sitePages.tenantId, tenantId))).orderBy(sitePages.path)
    return { ...site, pages }
  })
}

export async function listSiteForms(tenantId: string, siteId: string) {
  return withTenant(tenantId, async tx => {
    const rows = await tx.select({
      siteId: sitePages.siteId,
      pageId: sitePages.id,
      pageTitle: sitePages.title,
      pagePath: sitePages.path,
      html: sitePageVersions.html,
      manifest: sitePageVersions.formManifest,
      updatedAt: sitePageVersions.updatedAt
    }).from(sitePages)
      .innerJoin(sitePageVersions, eq(sitePageVersions.id, sitePages.draftVersionId))
      .where(and(eq(sitePages.siteId, siteId), eq(sitePages.tenantId, tenantId)))

    const connections = await tx.select({
      pageId: siteFormConnections.pageId,
      formKey: siteFormConnections.formKey,
      entityId: siteFormConnections.entityId,
      entityName: entities.name,
      entitySlug: entities.slug,
      fieldMapping: siteFormConnections.fieldMapping,
      defaultValues: siteFormConnections.defaultValues,
      valueMappings: siteFormConnections.valueMappings
    }).from(siteFormConnections)
      .innerJoin(entities, eq(entities.id, siteFormConnections.entityId))
      .where(and(eq(siteFormConnections.tenantId, tenantId), eq(siteFormConnections.siteId, siteId)))
    const connectionByForm = new Map(connections.map(connection => [`${connection.pageId}:${connection.formKey}`, connection]))

    return rows.flatMap(row => {
      const manifest = extractSiteForms(row.html)
      return manifest.map(form => ({
        ...form,
        siteId: row.siteId,
        pageId: row.pageId,
        pageTitle: row.pageTitle,
        pagePath: row.pagePath,
        updatedAt: row.updatedAt,
        connection: connectionByForm.get(`${row.pageId}:${form.id}`) ?? null
      }))
    })
  })
}

export async function updateSite(tenantId: string, siteId: string, input: { name: string; slug: string; locale: string }) {
  return withTenant(tenantId, async tx => {
    try {
      const [site] = await tx.update(sites).set({ ...input, updatedAt: new Date() })
        .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId))).returning()
      return site ?? null
    } catch (error) {
      if (pgCode(error) === '23505') throw new DuplicateSiteError(`Ya existe un sitio con el slug "${input.slug}"`)
      throw error
    }
  })
}

export async function createSite(tenantId: string, userId: string, input: { name: string; slug: string; locale?: string }) {
  return withTenant(tenantId, async tx => {
    try {
      const [site] = await tx.insert(sites).values({ tenantId, name: input.name, slug: input.slug, locale: input.locale ?? 'es-MX', createdBy: userId }).returning()
      const [page] = await tx.insert(sitePages).values({ tenantId, siteId: site.id, path: '/', title: 'Inicio', createdBy: userId }).returning()
      const [version] = await tx.insert(sitePageVersions).values({ tenantId, siteId: site.id, pageId: page.id, version: 1, html: DEFAULT_HOME_HTML, css: DEFAULT_HOME_CSS, createdBy: userId }).returning()
      await tx.update(sitePages).set({ draftVersionId: version.id, updatedAt: new Date() }).where(eq(sitePages.id, page.id))
      return { ...site, pageCount: 1 }
    } catch (error) {
      if (pgCode(error) === '23505') throw new DuplicateSiteError(`Ya existe un sitio con el slug "${input.slug}"`)
      throw error
    }
  })
}

export async function createSitePage(tenantId: string, userId: string, siteId: string, input: { title: string; path: string; kind?: 'website' | 'landing' }) {
  return withTenant(tenantId, async tx => {
    const [site] = await tx.select({ id: sites.id }).from(sites).where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId))).limit(1)
    if (!site) return null
    const path = normalizeSitePath(input.path)
    try {
      const [page] = await tx.insert(sitePages).values({ tenantId, siteId, title: input.title, path, kind: input.kind ?? 'website', createdBy: userId }).returning()
      const [version] = await tx.insert(sitePageVersions).values({ tenantId, siteId, pageId: page.id, version: 1, html: `<main class="flow-site-page"><h1>${escapeHtml(input.title)}</h1></main>`, css: DEFAULT_HOME_CSS, createdBy: userId }).returning()
      await tx.update(sitePages).set({ draftVersionId: version.id, updatedAt: new Date() }).where(eq(sitePages.id, page.id))
      return { ...page, draftVersionId: version.id }
    } catch (error) {
      if (pgCode(error) === '23505') throw new DuplicateSiteError(`Ya existe una página con la ruta "${path}"`)
      throw error
    }
  })
}

export async function getSitePage(tenantId: string, siteId: string, pageId: string) {
  return withTenant(tenantId, async tx => {
    const [page] = await tx.select().from(sitePages).where(and(eq(sitePages.id, pageId), eq(sitePages.siteId, siteId), eq(sitePages.tenantId, tenantId))).limit(1)
    if (!page) return null
    const [draft] = page.draftVersionId ? await tx.select().from(sitePageVersions).where(and(eq(sitePageVersions.id, page.draftVersionId), eq(sitePageVersions.tenantId, tenantId))).limit(1) : []
    const versions = await tx.select({ id: sitePageVersions.id, version: sitePageVersions.version, status: sitePageVersions.status, createdAt: sitePageVersions.createdAt, updatedAt: sitePageVersions.updatedAt }).from(sitePageVersions).where(and(eq(sitePageVersions.pageId, pageId), eq(sitePageVersions.tenantId, tenantId))).orderBy(desc(sitePageVersions.version))
    return { ...page, draft: draft ?? null, versions, agendaWarnings: await agendaMarkerWarnings(tx, tenantId, siteId, draft?.html ?? ''), agendaPreview: await agendaEditorPreviewState(tx, tenantId, siteId) }
  })
}

export async function saveSitePageDraft(tenantId: string, userId: string, siteId: string, pageId: string, input: { title: string; path: string; html: string; css: string }) {
  return withTenant(tenantId, async tx => {
    const [page] = await tx.select().from(sitePages).where(and(eq(sitePages.id, pageId), eq(sitePages.siteId, siteId), eq(sitePages.tenantId, tenantId))).limit(1)
    if (!page) return null
    const path = normalizeSitePath(input.path)
    try {
      let draftId = page.draftVersionId
      const formManifest = extractSiteForms(input.html)
      if (draftId) await tx.update(sitePageVersions).set({ html: input.html, css: input.css, formManifest, updatedAt: new Date() }).where(and(eq(sitePageVersions.id, draftId), eq(sitePageVersions.tenantId, tenantId)))
      else {
        const [latest] = await tx.select({ value: max(sitePageVersions.version) }).from(sitePageVersions).where(and(eq(sitePageVersions.pageId, pageId), eq(sitePageVersions.tenantId, tenantId)))
        const [version] = await tx.insert(sitePageVersions).values({ tenantId, siteId, pageId, version: (latest?.value ?? 0) + 1, html: input.html, css: input.css, formManifest, createdBy: userId }).returning()
        draftId = version.id
      }
      const [updated] = await tx.update(sitePages).set({ title: input.title, path, draftVersionId: draftId, updatedAt: new Date() }).where(eq(sitePages.id, pageId)).returning()
      return { ...updated, agendaWarnings: await agendaMarkerWarnings(tx, tenantId, siteId, input.html) }
    } catch (error) {
      if (pgCode(error) === '23505') throw new DuplicateSiteError(`Ya existe una página con la ruta "${path}"`)
      throw error
    }
  })
}
export async function listAllSitePages(tenantId: string, kind?: 'website' | 'landing') {
  return withTenant(tenantId, async tx => {
    const where = kind
      ? and(eq(sitePages.tenantId, tenantId), eq(sitePages.kind, kind))
      : eq(sitePages.tenantId, tenantId)
    const rows = await tx.select({
      id: sitePages.id,
      siteId: sitePages.siteId,
      siteName: sites.name,
      siteSlug: sites.slug,
      title: sitePages.title,
      path: sitePages.path,
      kind: sitePages.kind,
      status: sitePages.status,
      updatedAt: sitePages.updatedAt,
      publishedVersionId: sitePages.publishedVersionId,
      manifest: sitePageVersions.formManifest
    }).from(sitePages)
      .innerJoin(sites, eq(sites.id, sitePages.siteId))
      .leftJoin(sitePageVersions, eq(sitePageVersions.id, sitePages.draftVersionId))
      .where(where)
      .orderBy(desc(sitePages.updatedAt))
    return rows.map(row => ({
      ...row,
      formCount: Array.isArray(row.manifest) ? row.manifest.length : 0,
      manifest: undefined
    }))
  })
}

export async function listAllSiteForms(tenantId: string) {
  return withTenant(tenantId, async tx => {
    const rows = await tx.select({
      siteId: sites.id,
      siteName: sites.name,
      siteSlug: sites.slug,
      pageId: sitePages.id,
      pageTitle: sitePages.title,
      pagePath: sitePages.path,
      html: sitePageVersions.html,
      manifest: sitePageVersions.formManifest,
      updatedAt: sitePageVersions.updatedAt
    }).from(sitePages)
      .innerJoin(sites, eq(sites.id, sitePages.siteId))
      .innerJoin(sitePageVersions, eq(sitePageVersions.id, sitePages.draftVersionId))
      .where(eq(sitePages.tenantId, tenantId))
      .orderBy(desc(sitePageVersions.updatedAt))
    const connections = await tx.select({
      pageId: siteFormConnections.pageId,
      formKey: siteFormConnections.formKey,
      entityId: siteFormConnections.entityId,
      entityName: entities.name,
      entitySlug: entities.slug,
      fieldMapping: siteFormConnections.fieldMapping,
      defaultValues: siteFormConnections.defaultValues,
      valueMappings: siteFormConnections.valueMappings
    }).from(siteFormConnections)
      .innerJoin(entities, eq(entities.id, siteFormConnections.entityId))
      .where(eq(siteFormConnections.tenantId, tenantId))
    const connectionByForm = new Map(connections.map(connection => [`${connection.pageId}:${connection.formKey}`, connection]))

    return rows.flatMap(row => {
      const manifest = extractSiteForms(row.html)
      return manifest.map(form => ({
        ...form,
        siteId: row.siteId,
        siteName: row.siteName,
        siteSlug: row.siteSlug,
        pageId: row.pageId,
        pageTitle: row.pageTitle,
        pagePath: row.pagePath,
        updatedAt: row.updatedAt,
        connection: connectionByForm.get(`${row.pageId}:${form.id}`) ?? null
      }))
    })
  })
}

export async function listSitePublications(tenantId: string, siteId: string) {
  return withTenant(tenantId, async tx => tx.select({
    id: sitePageVersions.id,
    pageId: sitePages.id,
    pageTitle: sitePages.title,
    pagePath: sitePages.path,
    version: sitePageVersions.version,
    status: sitePageVersions.status,
    createdAt: sitePageVersions.createdAt,
    updatedAt: sitePageVersions.updatedAt
  }).from(sitePageVersions)
    .innerJoin(sitePages, eq(sitePages.id, sitePageVersions.pageId))
    .where(and(eq(sitePageVersions.tenantId, tenantId), eq(sitePageVersions.siteId, siteId)))
    .orderBy(desc(sitePageVersions.updatedAt)))
}

export async function publishSitePage(tenantId: string, userId: string, siteId: string, pageId: string) {
  return withTenant(tenantId, async tx => {
    const [page] = await tx.select().from(sitePages).where(and(
      eq(sitePages.id, pageId),
      eq(sitePages.siteId, siteId),
      eq(sitePages.tenantId, tenantId)
    )).limit(1)
    if (!page?.draftVersionId) return null
    const [draft] = await tx.select().from(sitePageVersions).where(and(
      eq(sitePageVersions.id, page.draftVersionId),
      eq(sitePageVersions.tenantId, tenantId)
    )).limit(1)
    if (!draft) return null

    if (page.publishedVersionId) {
      await tx.update(sitePageVersions).set({ status: 'superseded', updatedAt: new Date() }).where(and(
        eq(sitePageVersions.id, page.publishedVersionId),
        eq(sitePageVersions.tenantId, tenantId)
      ))
    }
    await tx.update(sitePageVersions).set({ status: 'published', updatedAt: new Date() }).where(eq(sitePageVersions.id, draft.id))
    const [nextDraft] = await tx.insert(sitePageVersions).values({
      tenantId,
      siteId,
      pageId,
      version: draft.version + 1,
      status: 'draft',
      html: draft.html,
      css: draft.css,
      formManifest: draft.formManifest,
      createdBy: userId
    }).returning()
    const [updated] = await tx.update(sitePages).set({
      status: 'published',
      publishedVersionId: draft.id,
      draftVersionId: nextDraft.id,
      updatedAt: new Date()
    }).where(eq(sitePages.id, pageId)).returning()
    await tx.update(sites).set({ status: 'published', updatedAt: new Date() }).where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)))
    return updated ? { ...updated, agendaWarnings: await agendaMarkerWarnings(tx, tenantId, siteId, draft.html) } : null
  })
}

export async function connectSiteForm(tenantId: string, userId: string, siteId: string, input: {
  pageId: string
  formKey: string
  entityId: string
  fieldMapping?: Record<string, string>
  defaultValues?: Record<string, SiteFormConnectionValue>
  valueMappings?: SiteFormValueMappings
}) {
  return withTenant(tenantId, async tx => {
    const [page] = await tx.select({ id: sitePages.id, draftVersionId: sitePages.draftVersionId }).from(sitePages).where(and(
      eq(sitePages.id, input.pageId),
      eq(sitePages.siteId, siteId),
      eq(sitePages.tenantId, tenantId)
    )).limit(1)
    if (!page?.draftVersionId) return null
    const [version] = await tx.select({
      manifest: sitePageVersions.formManifest,
      html: sitePageVersions.html
    }).from(sitePageVersions).where(and(
      eq(sitePageVersions.id, page.draftVersionId),
      eq(sitePageVersions.tenantId, tenantId)
    )).limit(1)
    const manifest = extractSiteForms(version?.html ?? '')
    const form = manifest.find(form => form.id === input.formKey)
    if (!form) return null
    const [entity] = await tx.select({ id: entities.id }).from(entities).where(and(
      eq(entities.id, input.entityId),
      eq(entities.tenantId, tenantId),
      eq(entities.isActive, true)
    )).limit(1)
    if (!entity) return null
    const targetFields = await tx.select({
      name: entityFields.name,
      label: entityFields.label,
      dataType: entityFields.dataType,
      validationRules: entityFields.validationRules,
      isRequired: entityFields.isRequired
    }).from(entityFields).where(eq(entityFields.entityId, input.entityId))
    const sourceNames = new Set(form.fields.map(field => field.name))
    const mappableTargetNames = new Set(targetFields
      .filter(field => ['text', 'number', 'currency', 'boolean', 'date', 'select', 'multiselect'].includes(field.dataType))
      .map(field => field.name))
    const requestedMapping = input.fieldMapping ?? {}
    const mappedTargets = new Set<string>()
    for (const [sourceName, targetName] of Object.entries(requestedMapping)) {
      if (!sourceNames.has(sourceName) || !mappableTargetNames.has(targetName)) {
        throw createError({ statusCode: 422, statusMessage: 'El mapeo contiene campos que no existen o no son compatibles.' })
      }
      if (mappedTargets.has(targetName)) {
        throw createError({ statusCode: 422, statusMessage: 'Dos campos del formulario no pueden guardar datos en el mismo campo de destino.' })
      }
      mappedTargets.add(targetName)
    }
    const fieldMapping = input.fieldMapping !== undefined
      ? requestedMapping
      : Object.fromEntries(form.fields
          .filter(field => mappableTargetNames.has(field.name))
          .map(field => [field.name, field.name]))
    const targetByName = new Map(targetFields.map(field => [field.name, field]))
    const defaultValues: Record<string, SiteFormConnectionValue> = {}
    for (const [targetName, value] of Object.entries(input.defaultValues ?? {})) {
      const field = targetByName.get(targetName)
      if (!field || !mappableTargetNames.has(targetName)) {
        throw createError({ statusCode: 422, statusMessage: 'Los valores predeterminados contienen campos incompatibles.' })
      }
      if (Object.values(fieldMapping).includes(targetName)) {
        throw createError({ statusCode: 422, statusMessage: `El campo "${field.label}" no puede recibir un dato del formulario y un valor predeterminado a la vez.` })
      }
      const normalized = normalizeConnectionDefault(field, value)
      if (normalized !== null) defaultValues[targetName] = normalized
    }
    const formFieldByName = new Map(form.fields.map(field => [field.name, field]))
    const valueMappings: SiteFormValueMappings = {}
    const configuredValueMappings = input.valueMappings ?? {}
    for (const sourceName of Object.keys(configuredValueMappings)) {
      if (!fieldMapping[sourceName]) {
        throw createError({ statusCode: 422, statusMessage: `La traducción de valores de "${sourceName}" no corresponde a un campo mapeado.` })
      }
    }
    for (const [sourceName, targetName] of Object.entries(fieldMapping)) {
      const sourceField = formFieldByName.get(sourceName)
      const targetField = targetByName.get(targetName)
      const configuredValues = configuredValueMappings[sourceName] ?? {}
      if (!sourceField?.options?.length || !targetField || !['select', 'multiselect'].includes(targetField.dataType)) continue
      const sourceOptions = new Set(sourceField.options.map(option => option.value))
      const targetOptions = new Set(((targetField.validationRules as { options?: Array<{ value?: string }> } | null)?.options ?? [])
        .map(option => option.value)
        .filter((option): option is string => Boolean(option)))
      const translations: Record<string, string> = {}
      for (const [sourceValue, targetValue] of Object.entries(configuredValues)) {
        if (!sourceOptions.has(sourceValue) || !targetOptions.has(targetValue)) {
          throw createError({ statusCode: 422, statusMessage: `La traducción de valores de "${sourceField.label}" contiene opciones inválidas.` })
        }
        if (sourceValue !== targetValue) translations[sourceValue] = targetValue
      }
      for (const option of sourceField.options) {
        const resolved = translations[option.value] ?? option.value
        if (targetOptions.size && !targetOptions.has(resolved)) {
          throw createError({
            statusCode: 422,
            statusMessage: `Define a qué opción de "${targetField.label}" corresponde "${option.label}".`
          })
        }
      }
      if (Object.keys(translations).length) valueMappings[sourceName] = translations
    }
    const requiredWithoutValue = targetFields.filter(field => {
      if (!field.isRequired || !mappableTargetNames.has(field.name)) return false
      if (hasConnectionValue(defaultValues[field.name])) return false
      const source = Object.entries(fieldMapping).find(([, target]) => target === field.name)?.[0]
      return !source || !formFieldByName.get(source)?.required
    })
    if (requiredWithoutValue.length) {
      throw createError({
        statusCode: 422,
        statusMessage: `Falta mapear o definir un valor predeterminado para: ${requiredWithoutValue.map(field => field.label).join(', ')}.`
      })
    }
    const [connection] = await tx.insert(siteFormConnections).values({
      tenantId,
      siteId,
      pageId: input.pageId,
      formKey: input.formKey,
      entityId: input.entityId,
      fieldMapping,
      defaultValues,
      valueMappings,
      createdBy: userId
    }).onConflictDoUpdate({
      target: [siteFormConnections.tenantId, siteFormConnections.siteId, siteFormConnections.pageId, siteFormConnections.formKey],
      set: { entityId: input.entityId, fieldMapping, defaultValues, valueMappings, status: 'active', updatedAt: new Date() }
    }).returning()
    return connection ?? null
  })
}

export async function disconnectSiteForm(tenantId: string, siteId: string, pageId: string, formKey: string) {
  return withTenant(tenantId, async tx => {
    const deleted = await tx.delete(siteFormConnections).where(and(
      eq(siteFormConnections.tenantId, tenantId),
      eq(siteFormConnections.siteId, siteId),
      eq(siteFormConnections.pageId, pageId),
      eq(siteFormConnections.formKey, formKey)
    )).returning({ id: siteFormConnections.id })
    return deleted.length > 0
  })
}
