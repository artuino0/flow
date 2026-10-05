// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { computed, createApp, h, nextTick, ref, Suspense, type App } from 'vue'
import { readFileSync } from 'node:fs'
import { compileVueComponent } from '../helpers/vueComponent'
import { auditThemeSource } from '../../scripts/auditThemeColors'
import type { SiteSeo } from '../../utils/siteSeo'
import { auditSiteSeo } from '../../utils/siteSeoAudit'
const apps: App[] = []
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks() })
it.each(['light', 'dark', 'system'] as const)('panel real accesible, editable y sin colores fijos: %s a 390 y 1440', async theme => {
  document.documentElement.dataset.theme = theme
  const model = ref<SiteSeo>({ title: 'Título original' }), save = vi.fn()
  const audit = auditSiteSeo({ id: 'p', title: 'Página', path: '/', status: 'draft', html: '<h1>Hola</h1>', css: '', seo: {} }, { locale: 'es-MX', domainActive: false, primary: false, googleVerified: false, rootPath: '/', pages: [], assets: [] })
  const globals = { computed, ref, useRequestHeaders: () => ({}), useFetch: async () => ({ data: ref({ assets: [{ id: 'image', fileName: 'logo-social.png', mimeType: 'image/png', publicUrl: '/local/logo.png' }] }), error: ref(null) }) }
  const panel = compileVueComponent('components/SitesSeoPanel.vue', {}, globals), checklist = compileVueComponent('components/SitesSeoChecklist.vue', {}, globals)
  const app = createApp({ render: () => h(Suspense, {}, { default: () => h(panel, { modelValue: model.value, 'onUpdate:modelValue': (value: SiteSeo) => { model.value = value }, siteId: 's', pageTitle: 'Página', pagePath: '/', saving: false, audit, onSave: save }) }) })
  app.component('SitesSeoChecklist', checklist)
  const host = document.createElement('div'); document.body.append(host); app.mount(host); apps.push(app)
  await new Promise(resolve => setTimeout(resolve, 0)); await nextTick()
  const title = host.querySelector<HTMLInputElement>('#seo-title')!
  expect(title.value).toBe('Título original'); expect(title.getAttribute('maxlength')).toBe('70')
  expect(host.querySelector('#' + title.getAttribute('aria-describedby'))?.textContent).toContain('15 / 70')
  title.value = 'Nuevo título'; title.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
  expect(model.value.title).toBe('Nuevo título'); expect(host.textContent).toContain('Nuevo título')
  title.value = ''; title.dispatchEvent(new Event('input', { bubbles: true })); await nextTick(); expect(model.value).not.toHaveProperty('title')
  const checkbox = host.querySelector<HTMLInputElement>('#seo-noindex')!; checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true })); await nextTick()
  expect(model.value.noindex).toBe(true); expect(host.textContent).toContain('Google no mostrará esta página')
  const image = host.querySelector<HTMLSelectElement>('#seo-image')!; image.value = 'image'; image.dispatchEvent(new Event('change', { bubbles: true })); await nextTick()
  expect(model.value.ogImageAssetId).toBe('image'); expect(host.querySelector('img')?.getAttribute('alt')).toBe('logo social')
  expect(host.textContent).toContain('Completar el checklist no garantiza una posición')
  expect(host.textContent).toContain(`${audit.ready} de ${audit.total} listos`)
  host.querySelector<HTMLButtonElement>('header button')!.click(); expect(save).toHaveBeenCalledOnce()
  for (const width of [390, 1440]) { Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }); expect(host.querySelector('section')?.classList.contains('seo-panel')).toBe(true) }
  for (const file of ['SitesSeoPanel', 'SitesSeoChecklist', 'SitesSeoSummary']) expect(auditThemeSource(`components/${file}.vue`, readFileSync(`components/${file}.vue`, 'utf8'))).toEqual([])
  expect(readFileSync('components/SitesSeoPanel.vue', 'utf8')).toContain('@media(max-width:720px)')
  expect(readFileSync('pages/sites/[siteId]/pages/[pageId].vue', 'utf8')).toContain('darkReady: true')
})
it('todos los endpoints nuevos y la edición exigen administración en servidor', () => {
  for (const file of ['server/api/sites/[siteId]/seo-audit.get.ts', 'server/api/sites/[siteId]/pages/[pageId].put.ts', 'server/api/sites/[siteId].put.ts', 'server/api/sites/domains/[id]/primary.post.ts']) expect(readFileSync(file, 'utf8')).toContain('await requireAdminRole(event)')
})
