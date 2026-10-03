// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, h, nextTick, onBeforeUnmount, onMounted, onUnmounted, reactive, ref, Suspense, watch, watchEffect, type App, type Component } from 'vue'
import { readFileSync } from 'node:fs'
import { compileVueComponent } from '../helpers/vueComponent'
import { useAgendaOffer } from '../../composables/useAgendaOffer'
import * as agendaBase from '../../utils/agendaBase'
import { auditThemeColors, migratedThemeFiles } from '../../scripts/auditThemeColors'
import { darkTokens, lightTokens } from '../../utils/themeTokens'
import { contentNeedsLight } from '../../utils/theme'
import baseline from '../fixtures/themeBaseline164.json'
import * as map from '../../utils/workflowMapLayout'
import * as icons from '../../utils/moduleIcons'
import * as tours from '../../utils/onboardingTours'
import * as badges from '../../utils/fieldTypeBadge'
import * as options from '../../utils/optionColors'
import { fieldTypeLabel } from '../../utils/fieldTypeLabels'
import * as filters from '../../utils/listFilters'
import * as tabs from '../../utils/moduleListingTabs'
import * as labels from '../../utils/labelTemplates'
import { slugify } from '../../utils/slugify'
import { contrast, isLabelContrast, themeContrasts } from '../helpers/themeContrast'

const routes = ['pages/modulos/index.vue', 'pages/modulos/nuevo.vue', 'pages/catalogos/index.vue', 'pages/catalogos/nuevo.vue', 'pages/chat/index.vue', 'pages/modulos/[id]/editar.vue']
const apps: App[] = []
const field = { id: 's', name: 'estado', label: 'Estado', dataType: 'select', isRequired: false, validationRules: { options: [{ value: 'nuevo', label: 'Nuevo', color: '#123456' }, { value: 'final', label: 'Final', color: '#EEDDCC' }] } }
const person = { id: 'other', name: 'Ana', email: 'ana@local', jobTitle: null }
const conversation = { id: 'c', type: 'direct', title: 'Ana', participants: [person], unreadCount: 1, canSend: true, canManage: false, lastMessage: null, archivedAt: null }
const message = { id: 'm', conversationId: 'c', body: 'Hola @Ana https://ejemplo.local', sender: person, attachments: [{ id: 'f', fileName: 'nota.pdf', url: '/local/nota.pdf' }], createdAt: '2026-10-02T12:00:00Z', editedAt: null, deletedAt: null, readCount: 0, replyTo: null, sharedRecord: null, gifUrl: null }
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick() }
const toast = { success: vi.fn(), error: vi.fn(), updated: vi.fn() }
function response(url: string) {
  if (url === '/api/roles') return { roles: [] }
  if (url === '/api/navigation') return { revision: 1, layout: { groups: [] }, entities: [] }
  if (url === '/api/relation-definitions') return []
  if (url.startsWith('/api/records/')) return { data: [], total: 0, relationLabels: {} }
  if (url === '/api/notifications/recipients') return { users: [{ id: 'other', label: 'Ana', email: 'ana@local' }], roles: [] }
  if (url === '/api/entities') return { entities: [] }
  throw new Error(`Petición no simulada: ${url}`)
}
async function mount(file: string, theme: string, props: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, lightScope = false) {
  document.documentElement.dataset.theme = theme
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
  document.body.dataset.contentTheme = theme
  vi.stubGlobal('$fetch', vi.fn(async (url: string) => response(url)))
  const globals = { ref, computed, reactive, watch, watchEffect, nextTick, onMounted, onBeforeUnmount, onUnmounted,
    useAgendaOffer,
    definePageMeta: vi.fn(), useRequestHeaders: () => ({}), useRoute: () => ({ query: {}, params: {} }), useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
    useAuth: () => ({ user: ref({ id: 'self' }) }), useToast: () => toast, useConfirm: () => ({ confirm: vi.fn(async () => true) }),
    usePlanLimit: () => ({ handlePlanLimitError: vi.fn(), checkBeforeCreate: vi.fn(async () => true) }), useRequestURL: () => new URL('http://local.test'),
    useFetch: async (url: string) => ({ data: ref(response(url)), pending: ref(false), error: ref(null), refresh: vi.fn() }), pluralize: (s: string) => s + 's', slugify, navigateTo: vi.fn(), refreshNuxtData: vi.fn(), ...extra }
  const imports = { '~/utils/workflowMapLayout': map, '~/utils/moduleIcons': icons, '~/utils/onboardingTours': tours, '~/utils/fieldTypeBadge': badges, '~/utils/listFilters': filters, '~/utils/moduleListingTabs': tabs, '~/utils/labelTemplates': labels,
    '~/utils/agendaBase': agendaBase,
    '~/components/ModuleNavigationEditor.vue': { default: { render: () => h('div', { 'data-component': 'navigation' }) } }, '~/components/ModuleApiDocs.vue': { default: { render: () => h('div', { 'data-component': 'api' }) } },
    '~/components/FieldFormModal.vue': { default: { render: () => h('div') } }, '~/components/FieldImpactWarningModal.vue': { default: { render: () => h('div') } } }
  const component = compileVueComponent(file, imports, globals, { client: false, server: false, dev: false })
  const agendaModal = compileVueComponent('components/AgendaBaseModal.vue')
  const host = document.createElement('div'); document.body.append(host)
  const app = createApp({ render: () => h(Suspense, {}, { default: () => h(component, props) }) })
  app.component('AgendaBaseModal', agendaModal)
  const stub: Component = { setup(_, { slots }) { return () => h('div', {}, Object.values(slots).flatMap(slot => slot?.({ href: '/local', navigate: vi.fn(), activeView: 'table' }) ?? [])) } }
  Object.defineProperties(app.config.globalProperties, { fieldTypeLabel: { value: fieldTypeLabel }, colorDotClass: { value: options.colorDotClass }, colorBadgeClasses: { value: options.colorBadgeClasses } })
  for (const name of ['NuxtLink', 'ListPageHeader', 'ModuleTourHelpButton', 'DynamicTable', 'DynamicForm', 'ChatAvatar', 'ChatGifPicker', 'ChatConversationList', 'ChatThread', 'ChatNewConversationModal', 'ChatGroupEditModal', 'ModuleListing', 'ModuleWizard', 'ModuleFieldsCard', 'ModulePreviewCard', 'ModuleDetailLayoutCard', 'ModuleListLayoutCard', 'ModuleListPreviewCard', 'ModuleStateWorkflowCard', 'ModuleRelationsCard', 'ModuleLabelEditor', 'RecordDetailView', 'IconPicker', 'ReportOptionSelect']) app.component(name, stub)
  app.mount(host); apps.push(app); await flush()
  expect(document.documentElement.style.colorScheme).toBe(theme)
  if (lightScope) expect(host.querySelector('.theme-light')).not.toBeNull()
  else expect(host.querySelector('.theme-light')).toBeNull()
  return host
}
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('contratos HU-164', () => {
  it('conserva todos los tokens de HEAD y los claros nuevos tienen procedencia real', () => {
    for (const [theme, values] of Object.entries(baseline)) for (const [name, value] of Object.entries(values)) expect((theme === 'light' ? lightTokens : darkTokens)[name as keyof typeof lightTokens]).toBe(value)
    const originals = { 'recipient-text': '#006F86', 'recipient-role': '#6534B0', 'module-code-bg': '#172B4D', 'module-code-text': '#D9E7F5', 'chat-own-border': '#B7E7EF', 'chat-warning-bg': '#FFF4E5', 'chat-warning-text': '#8A5D00', 'chat-warning-border': '#C58B2A' } as const
    for (const [name, value] of Object.entries(originals)) { expect(lightTokens[name as keyof typeof lightTokens]).toBe(value); expect(darkTokens[name as keyof typeof lightTokens]).toMatch(/^#[\dA-F]{6}$/) }
  })
  it('marca las rutas completas y mantiene diseñador, facturación e impresión protegidos', () => {
    for (const file of routes) { expect(readFileSync(file, 'utf8')).toContain('darkReady: true'); expect(migratedThemeFiles).toContain(file) }
    expect(contentNeedsLight({ darkReady: true })).toBe(false)
    expect(contentNeedsLight({})).toBe(true)
    for (const file of ['pages/facturacion/index.vue']) expect(readFileSync(file, 'utf8')).toContain('darkReady: true')
    expect(readFileSync('components/PrintReportPreview.vue', 'utf8')).toContain('theme-light')
    expect(auditThemeColors()).toEqual([])
  })
  it('los controles nativos heredan esquema y mantienen pulgares blancos como parte del control', () => {
    for (const file of ['components/ModuleWizard.vue', 'components/ModuleLabelEditor.vue', 'components/ModuleStateWorkflowCard.vue', 'components/ModuleListLayoutCard.vue', 'components/ChatThread.vue', 'components/WorkflowNotificationRecipients.vue']) expect(readFileSync(file, 'utf8')).toContain('color-scheme: inherit')
    expect(lightTokens['switch-thumb']).toBe('#FFFFFF'); expect(darkTokens['switch-thumb']).toBe('#FFFFFF')
  })
  it('conserva los veinte colores claros originales del editor de etiquetas', () => {
    const originals = { muted: '#8BA0B5', heading: '#16324F', 'toggle-bg': '#B9C7D3', 'toggle-active': '#FF765B', label: '#38536E', 'control-border': '#CBD9E5', 'control-text': '#334E68', focus: '#0097B2', divider: '#E6EDF3', section: '#294866', secondary: '#52718F', 'selected-bg': '#E7F5F7', 'selected-text': '#007F99', icon: '#5D7993', stage: '#F1F6F8', 'paper-border': '#BCCBD7', ink: '#183651', shadow: '#183651', 'paper-muted': '#66829D', 'paper-separator': '#B5C2CC' }
    for (const [name, value] of Object.entries(originals)) expect(lightTokens[`label-${name}` as keyof typeof lightTokens]).toBe(value)
  })
  it('separa los seis déficits claros autorizados y exige AA en cada par oscuro nuevo de etiquetas', () => {
    const pairs = themeContrasts().filter(isLabelContrast)
    const deficits = pairs.filter(pair => pair.ratio < pair.minimum)
    expect(deficits.map(pair => [pair.id, Number(pair.ratio.toFixed(3)), pair.minimum])).toEqual([
      ['light:label-muted/surface', 2.695, 4.5], ['light:label-selected-text/label-selected-bg', 4.182, 4.5],
      ['light:label-paper-muted/surface', 4.004, 4.5], ['light:label-control-border/surface', 1.439, 3],
      ['light:label-toggle-bg/surface', 1.725, 3], ['light:label-toggle-active/surface', 2.627, 3]
    ])
    expect(pairs.filter(pair => pair.theme === 'dark')).toHaveLength(14)
    for (const pair of pairs.filter(pair => pair.theme === 'dark')) expect(pair.ratio, pair.id).toBeGreaterThanOrEqual(pair.minimum)
  })
})

describe.each(['light', 'dark'])('montajes HU-164 sin red, %s', theme => {
  it('chat monta reconexión y estado vacío sin red', async () => {
    const state = ref({ ready: true, loading: false, selectedId: null, floatingIds: [], conversations: [], archived: [], messages: {}, presence: {}, typing: {}, permissions: { effective: { canStartDirect: true } } })
    const chat = { state, canAccess: ref(true), realtimeState: ref({ reconnecting: true }), conversation: () => null, initialize: vi.fn(), dispose: vi.fn() }
    const host = await mount('pages/chat/index.vue', theme, {}, { useChat: () => chat })
    expect(host.querySelector('.bg-brand-chat-warning-bg')?.textContent).toContain('Reconectando')
    expect(host.textContent).toContain('Selecciona una conversación')
  })
  it.each(['basica', 'campos', 'relaciones', 'detalle', 'listado', 'flujo', 'etiquetas', 'navegacion', 'api'])('editar pestaña %s sigue el tema de la ruta', async step => {
    const entity = { id: 'e', name: 'Citas', slug: 'citas', moduleKind: 'hecho', isActive: true, deletedAt: null, labelConfig: labels.DEFAULT_LABEL_CONFIG }
    const fieldResponse = { entity, fields: [field], inverseRelations: [], detailLayout: { properties: [], relations: [], showActivity: false }, listLayout: { columns: [], filterFields: [] }, boardConfig: { enabled: false, secondaryFields: [] }, calendarConfig: { enabled: false } }
    const host = await mount('pages/modulos/[id]/editar.vue', theme, {}, { useRoute: () => ({ params: { id: 'e' }, query: {} }), useModuleEditTab: () => ref(step), useFetch: async (url: string | (() => string)) => ({ data: ref((typeof url === 'function' ? url() : url) === '/api/entities' ? { entities: [entity] } : fieldResponse), pending: ref(false), error: ref(null), refresh: vi.fn() }) })
    expect(host.textContent).toContain('Citas')
  })
  it('opción Select conserva el dato de color y su insignia semántica', async () => {
    const select = { ...field, validationRules: { options: [{ value: 'nuevo', label: 'Nuevo', color: 'purple' }] } }
    const before = JSON.stringify(select)
    const host = await mount('components/DynamicSelectField.vue', theme, { field: select, modelValue: 'nuevo', detail: true })
    expect(host.querySelector('.bg-brand-purple-text')).not.toBeNull()
    expect(host.textContent).toContain('Nuevo')
    expect(JSON.stringify(select)).toBe(before)
  })
  it('etiqueta impresa conserva paleta clara, código de barras y configuración, sin campo de color configurable', async () => {
    const config = { ...labels.DEFAULT_LABEL_CONFIG, enabled: true, titleField: 'estado', barcodeField: 'estado' }
    const before = JSON.stringify(config)
    const host = await mount('components/ModuleLabelEditor.vue', theme, { modelValue: config, fields: [field], moduleName: 'Citas' }, { useFetch: () => ({ data: ref({ hasLogo: false }) }) }, true)
    expect(host.querySelector('.label-preview svg')).not.toBeNull()
    expect(JSON.stringify(config)).toBe(before)
    expect(host.querySelector('input[type="color"]')).toBeNull()
    expect(host.querySelector('.label-editor-grid')?.classList.contains('theme-light')).toBe(false)
    expect(host.querySelectorAll('.theme-light')).toHaveLength(1)
    expect(host.querySelector('.label-preview')?.classList.contains('theme-light')).toBe(true)
  })
  it.each(routes.slice(0, 4))('página %s sin aislamiento claro', async file => { expect((await mount(file, theme)).children.length).toBeGreaterThan(0) })
  it.each(['hecho', 'dimension'])('listado y wizard %s con estados vacíos', async moduleKind => {
    const props = { moduleKind, basePath: '/modulos', sectionLabel: 'Módulos', noun: 'módulo', subtitle: 'Datos', searchPlaceholder: 'Buscar', createLabel: 'Crear', nameHelperText: 'Nombre' }
    const listing = await mount('components/ModuleListing.vue', theme, props)
    expect(listing.textContent).toContain('módulo')
    const wizard = await mount('components/ModuleWizard.vue', theme, props)
    expect(wizard.querySelector('input')).not.toBeNull()
    expect(wizard.textContent).toContain('Información básica')
    const fieldsResponse = { fields: [field], inverseRelations: [], detailLayout: { properties: [], relations: [], showActivity: false }, listLayout: { columns: [], filterFields: [] }, boardConfig: { enabled: false, secondaryFields: [] }, calendarConfig: { enabled: false } }
    const fetch = vi.fn(async (url: string) => url === '/api/entities' ? { id: 'e', slug: 'citas' } : url.endsWith('/fields') ? fieldsResponse : {})
    vi.stubGlobal('$fetch', fetch)
    const name = wizard.querySelector('input')!
    name.value = 'Citas'; name.dispatchEvent(new Event('input', { bubbles: true })); await flush()
    const click = async (label: string) => { const button = [...wizard.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label); expect(button, label).toBeDefined(); button!.click(); await flush() }
    await click('Continuar')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Citas prearmado')
    expect(fetch.mock.calls.some(([url]) => url === '/api/entities')).toBe(false)
    const own = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent?.trim() === 'Crear el mío')!
    expect(own).toBeDefined(); own.click(); await flush()
    expect(fetch).toHaveBeenCalledWith('/api/entities', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ name: 'Citas', moduleKind }) }))
    await click('Continuar')
    expect(wizard.textContent).toContain('Guardar diseño')
    await click('Guardar diseño')
    expect(wizard.textContent).toContain('Diseño del listado')
    expect(fetch).toHaveBeenCalledWith('/api/entities/e', expect.objectContaining({ method: 'PUT', body: { detailLayout: fieldsResponse.detailLayout } }))
    expect(wizard.querySelector('.theme-light')).toBeNull()
  })
  it('campos y formulario en vivo siguen tema y conservan badges por tipo', async () => {
    const fields = await mount('components/ModuleFieldsCard.vue', theme, { entityId: 'e', entityName: 'Citas', fields: [field] })
    expect(fields.textContent).toContain('Estado'); expect(fields.querySelector('.bg-brand-info-bg')).not.toBeNull()
    const preview = await mount('components/ModulePreviewCard.vue', theme, { moduleName: 'Citas', fields: [field] })
    expect(preview.textContent).toContain('Vista previa en vivo')
  })
  it('diseño de detalle y listado conservan controles de selección y vistas', async () => {
    const detail = await mount('components/ModuleDetailLayoutCard.vue', theme, { modelValue: { properties: [{ fieldName: 'estado', visible: true }], relations: [], showActivity: true }, fields: [field], inverseRelations: [] })
    expect(detail.querySelector('.bg-brand-switch-thumb')).not.toBeNull()
    const listing = await mount('components/ModuleListLayoutCard.vue', theme, { modelValue: { columns: [], filterFields: [], defaultSort: null }, fields: [field], boardConfig: { enabled: false, statusField: null, titleField: null, secondaryFields: [] }, calendarConfig: { enabled: false, startDateField: null, defaultView: 'month' } })
    expect(listing.textContent).toContain('Listado')
    for (const activeView of ['table', 'board', 'calendar']) {
      const preview = await mount('components/ModuleListPreviewCard.vue', theme, { entitySlug: 'citas', entityName: 'Citas', fields: [field], listLayout: { columns: [], filterFields: [] }, activeView, boardConfig: { enabled: true, statusField: 'estado', titleField: 'estado', secondaryFields: [] }, calendarConfig: { enabled: true, startDateField: 'fecha', defaultView: 'month' } })
      expect(preview.children.length).toBeGreaterThan(0)
    }
  })
  it('flujo conserva datos de estados y usa tokens SVG para nodos y aristas', async () => {
    const config = { enabled: true, field: 'estado', initial: 'nuevo', states: { nuevo: { color: '#ABCDEF', locked: false, editableFields: [] }, final: { color: '#FEDCBA', locked: true, editableFields: [] } }, transitions: [{ from: 'nuevo', to: 'final', roles: 'all' }] }
    const before = JSON.stringify(config)
    const host = await mount('components/ModuleStateWorkflowCard.vue', theme, { moduleId: 'e', fields: [field], config })
    expect(host.querySelector('rect')?.getAttribute('fill')).toBe('rgb(var(--brand-blue-bg))')
    expect(host.querySelector('text')?.getAttribute('fill')).toBe('rgb(var(--brand-text))')
    expect(JSON.stringify(config)).toBe(before)
    expect(field.validationRules.options[0].color).toBe('#123456')
  })
  it.each(['ModuleRelationsCard', 'ModuleNavigationEditor', 'ModuleApiDocs'])('%s vacío sin colores fijos', async name => {
    const host = await mount(`components/${name}.vue`, theme, { entityId: 'e', entityName: 'Citas', entitySlug: 'citas', fields: [field], entityOptions: [] })
    expect(host.children.length).toBeGreaterThan(0)
  })
  it('destinatarios, GIF y creación/edición de grupo tienen superficies temáticas', async () => {
    const recipients = await mount('components/WorkflowNotificationRecipients.vue', theme, { modelValue: [] })
    expect(recipients.querySelector('input')).not.toBeNull()
    expect((await mount('components/ChatGifPicker.vue', theme)).querySelector('.bg-brand-surface')).not.toBeNull()
    await mount('components/ChatNewConversationModal.vue', theme, { users: [person], canCreateGroups: true })
    await mount('components/ChatGroupEditModal.vue', theme, { users: [person], conversation: { ...conversation, type: 'group' } })
    expect(document.body.querySelectorAll('.fixed .bg-brand-surface').length).toBe(2)
  })
  it('chat distingue propios/ajenos por alineación y mantiene adjuntos, menciones y escritura', async () => {
    const host = await mount('components/ChatThread.vue', theme, { conversation, messages: [message, { ...message, id: 'own', sender: { ...person, id: 'self' } }], currentUserId: 'self', canAttach: true, users: [person], typingUserIds: ['other'] })
    expect(host.querySelector('.justify-start .bg-brand-surface')).not.toBeNull()
    expect(host.querySelector('.justify-end .bg-brand-help-bg')).not.toBeNull()
    expect(host.querySelector('.justify-end .chat-own-message')).not.toBeNull()
    expect(readFileSync('components/ChatThread.vue', 'utf8')).toContain('light-dark(rgb(var(--brand-text-muted)), rgb(var(--brand-text-secondary)))')
    expect(contrast(darkTokens['text-secondary'], darkTokens['help-bg'])).toBeGreaterThanOrEqual(4.5)
    expect(host.querySelector('a[href="/local/nota.pdf"]')).not.toBeNull()
    expect(host.textContent).toContain('Hola @Ana https://ejemplo.local')
    expect(host.textContent).toContain('escribiendo')
    const input = host.querySelector('textarea')!
    input.value = '@A'; input.dispatchEvent(new Event('input', { bubbles: true })); await flush()
    expect(host.textContent).toContain('Mencionar trabajador')
    expect(host.querySelector('button[aria-label="Enviar"]')?.classList.contains('text-brand-primary-fg')).toBe(true)
    // Una burbuja del cascarón puede abrirse mientras la ruta de fondo sigue clara.
    document.body.dataset.contentTheme = 'light'
    host.querySelector<HTMLButtonElement>('.justify-end button.absolute')!.click(); await flush()
    const remove = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === 'Eliminar')!
    expect(remove).toBeDefined(); remove.click(); await flush()
    expect(document.body.querySelector('[data-theme-shell]')?.textContent).toContain('Eliminar mensaje')
    expect(document.body.querySelector('[data-theme-shell] .bg-brand-surface')).not.toBeNull()
    const blocked = await mount('components/ChatThread.vue', theme, { conversation, messages: [], currentUserId: 'self', canAttach: false, canSend: false, sendBlockedReason: 'Sin permiso' })
    expect(blocked.querySelector('.bg-brand-chat-warning-bg')?.textContent).toContain('Sin permiso')
  })
  it('avatares y conversaciones conservan identidad y selección sin colores generados', async () => {
    const avatar = await mount('components/ChatAvatar.vue', theme, { name: 'Ana Pérez', online: true })
    expect(avatar.textContent).toContain('AP'); expect(avatar.querySelector('.bg-brand-stage-cyan')).not.toBeNull()
    const host = await mount('components/ChatConversationList.vue', theme, { conversations: [conversation], selectedId: 'c', currentUserId: 'self', presence: {} })
    expect(host.querySelector('.bg-brand-sidebar-active-bg')).not.toBeNull()
    const chat = { state: ref({ floatingIds: ['c'], minimizedIds: ['c'], messages: {}, permissions: { effective: {} }, presence: {}, typing: {} }), canAccess: ref(true), conversation: () => conversation, initialize: vi.fn(), dispose: vi.fn() }
    const dock = await mount('components/ChatFloatingDock.vue', theme, {}, { useChat: () => chat })
    expect(dock.querySelector('.bg-brand-surface')?.classList.contains('h-[50px]')).toBe(true)
  })
})
