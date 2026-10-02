// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, h, nextTick, onBeforeUnmount, onMounted, onUnmounted, reactive, ref, Suspense, watch, watchEffect, type App, type Component } from 'vue'
import { readFileSync } from 'node:fs'
import { compileVueComponent } from '../helpers/vueComponent'
import { auditThemeColors, migratedThemeFiles } from '../../scripts/auditThemeColors'
import { darkTokens, lightTokens, rgbChannels } from '../../utils/themeTokens'
import { contentNeedsLight } from '../../utils/theme'
import baseline from '../fixtures/themeBaseline163.json'
import baseline164 from '../fixtures/themeBaseline164.json'
import * as flowApps from '../../utils/flowApps'
import * as capabilities from '../../utils/flowCapabilities'
import * as planConcepts from '../../utils/planConcepts'
import * as platformForm from '../../utils/platformPlanForm'
import * as moduleIcons from '../../utils/moduleIcons'
import * as navigation from '../../utils/moduleNavigation'
import PapaParser from 'papaparse'

const routes = ['pages/ajustes/index.vue', 'pages/mi-cuenta.vue', 'pages/organizacion.vue', 'pages/usuarios/index.vue', 'pages/usuarios/[id].vue', 'pages/roles/index.vue', 'pages/platform/plans.vue', 'pages/registros/[entity]/importar.vue']
const added = { 'settings-overlay': '#1D2939', 'settings-dialog-overlay': '#1D293B', 'billing-divider': '#EEF2F6', 'billing-warning-fill': '#D99A16', 'billing-critical-fill': '#E05B43', 'billing-sites': '#36B9D1', 'billing-docs': '#9BDDED', 'billing-history': '#DFE8EF', 'billing-warning-border': '#F4D58D', 'billing-warning-bg': '#FFF4D6', 'billing-warning-text': '#805800', 'billing-error-border': '#F0B7AD', 'billing-error-bg': '#FDE7E3', 'billing-error-text': '#A83420', 'billing-info-border': '#BEE4EC', 'billing-info-bg': '#EAF7FA', 'billing-info-text': '#086F83' } as const
const imports = { '~/utils/flowApps': flowApps, '~/utils/flowCapabilities': capabilities, '~/utils/planConcepts': planConcepts, '~/utils/platformPlanForm': platformForm, '~/utils/moduleIcons': moduleIcons, '~/utils/moduleNavigation': navigation, papaparse: { default: PapaParser } }
const apps: App[] = []
const role = { id: 'r', name: 'Equipo', isSystem: false, userCount: 1 }
const user = { id: 'u', fullName: 'Ana', email: 'ana@local', isActive: true, status: 'activo', roleId: 'r', roleName: 'Equipo', createdAt: '2026-10-02', tenantName: 'Empresa', totpEnabled: false }
const tenant = { id: 't', name: 'Empresa', defaultCurrency: 'MXN', timezone: 'America/Mexico_City', country: 'MX', fiscalData: {}, hasLogo: true, email: null, phone: null, address: null, idleTimeoutMinutes: 30, idleWarningMinutes: 2 }
const plan = { id: 'p', code: 'starter', name: 'Starter', description: 'Plan de prueba', isActive: true, isPublic: true, sortOrder: 1, monthlyPriceCents: 10000, annualPriceCents: 100000, currency: 'MXN', limits: {}, blockedBy: [], stripeMonthlyPriceId: null, stripeAnnualPriceId: null }
const permission = { entityId: 'e', entitySlug: 'citas', entityName: 'Citas', moduleKind: 'hecho', showInMenu: true, canRead: true, canCreate: false, canUpdate: true, canDelete: false, visibility: 'all' }
const chatPermissions = { canAccess: true, canStartDirect: true, canSendAttachments: false, canCreateGroups: false }
const appPermissions = { 'core.access': true, 'automation.access': false, 'communications.access': true, 'sites.access': false, 'billing.access': false, 'settings.access': true }
const toast = { success: vi.fn(), error: vi.fn(), updated: vi.fn(), loading: vi.fn(() => 'loading'), dismiss: vi.fn() }
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick() }
function response(url: string) {
  if (url === '/api/tenant') return tenant
  if (url === '/api/tenant/pac') return { provider: 'facturapi', sandbox: true, hasApiKey: false, hasCsd: false }
  if (url === '/api/users') return { users: [user, { ...user, id: 'inv', status: 'invitacion_pendiente', isActive: false }] }
  if (url === '/api/roles') return { roles: [role] }
  if (url === '/api/users/u') return user
  if (url.endsWith('/app-permissions')) return { role, permissions: appPermissions, effective: appPermissions, overrides: {} }
  if (url.endsWith('/chat-permissions')) return { role, permissions: chatPermissions, effective: chatPermissions, overrides: {} }
  if (url.endsWith('/permissions')) return { role, permissions: [permission] }
  if (url === '/api/platform/plans') return { plans: [plan], organizations: [{ id: 't', name: 'Empresa', slug: 'empresa' }], overrides: [] }
  if (url === '/api/billing/plans') return { plans: [plan] }
  if (url === '/api/entities') return { entities: [] }
  if (url === '/api/navigation') return { revision: 1, layout: { groups: [] }, entities: [] }
  if (url === '/api/auth/sessions') return [{ id: 's', userAgent: 'Windows Chrome/130', current: false, lastSeenAt: '2026-10-02' }]
  if (url === '/api/settings/api-keys') return []
  if (url === '/api/settings/api-keys/entities') return { entities: [{ id: 'e', slug: 'citas', name: 'Citas', read: true, create: false, update: false, delete: false }] }
  if (url === '/api/settings/email') return { source: 'environment', configured: false, provider: 'smtp', host: '', port: 587, security: 'tls', username: '', fromEmail: '', fromName: '', replyTo: '' }
  if (url === '/api/notifications/groups') return { groups: [] }
  if (url === '/api/notifications/recipients') return { users: [{ id: 'u', label: 'Ana', email: 'ana@local' }] }
  if (url === '/api/agent/usage') return { users: [], totals: { ai_calls: 0 }, quota: { agentQueries: 10 } }
  throw new Error(`Petición no simulada: ${url}`)
}
function globals(section = 'organizacion') {
  return { ref, computed, reactive, watch, watchEffect, nextTick, onMounted, onUnmounted, onBeforeUnmount,
    definePageMeta: vi.fn(), onBeforeRouteLeave: vi.fn(), useRoute: () => ({ query: { section }, params: { entity: 'citas', id: 'u' } }), useRouter: () => ({ replace: vi.fn() }),
    useFetch: async (url: string | (() => string)) => ({ data: ref(response(typeof url === 'function' ? url() : url)), pending: ref(false), error: ref(null), status: ref('success'), refresh: vi.fn() }),
    useAuth: () => ({ user: ref(user), fetchMe: vi.fn(), logout: vi.fn() }), useIsAdmin: async () => ({ data: ref(true) }), useToast: () => toast,
    useConfirm: () => ({ confirm: vi.fn(async () => true) }), useSettingsDirty: () => ({ setDirty: vi.fn(), setSaveHandler: vi.fn(), setDiscardHandler: vi.fn() }),
    usePlanLimit: () => ({ checkBeforeCreate: vi.fn(async () => true), handlePlanLimitError: vi.fn() }), refreshNuxtData: vi.fn(), navigateTo: vi.fn(),
    useAgentSession: () => ({ headers: async () => ({}) }),
    useEntityFields: async () => ({ data: ref({ entity: { name: 'Citas' }, fields: [{ name: 'titulo', label: 'Título', isRequired: true }] }), pending: ref(false), error: ref(null) }),
    useBillingOverview: async () => ({ data: ref({ stripeConfigured: false, subscription: { plan, status: 'active', billingInterval: 'month', currentPeriodEnd: null, cancelAtPeriodEnd: false }, usage: [], invoices: [], usageHistory: [] }), pending: ref(false), error: ref(null), refresh: vi.fn() }),
    useDesignerPlanUsage: async () => ({ data: ref({ plan: 'Starter', usage: [] }), refresh: vi.fn() }) }
}
async function mount(file: string, theme: string, props: Record<string, unknown> = {}, section?: string, extra: Record<string, unknown> = {}) {
  document.documentElement.dataset.theme = theme
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
  document.body.dataset.contentTheme = theme
  vi.stubGlobal('$fetch', vi.fn(async (url: string) => response(url)))
  const component = compileVueComponent(file, imports, { ...globals(section), ...extra })
  const host = document.createElement('div'); document.body.append(host)
  const app = createApp({ render: () => h(Suspense, {}, { default: () => h(component, props) }) })
  const stub: Component = { setup(_, { slots }) { return () => h('div', {}, Object.values(slots).flatMap(slot => slot?.() ?? [])) } }
  for (const name of ['ListPageHeader', 'NuxtLink', 'ReportOptionSelect', 'SettingsProfile', 'SettingsSessions', 'SettingsApiKeys', 'SettingsBillingSummary', 'SettingsEmailAccordion', 'SettingsFiscalModuleMapping', 'SettingsNotificationGroups', 'SettingsConfirmDialog', 'AgentUsageTable', 'IconPicker', 'ModuleTourHelpButton']) app.component(name, stub)
  app.mount(host); apps.push(app); await flush()
  expect(document.documentElement.dataset.theme).toBe(theme)
  expect(document.documentElement.classList.contains('dark')).toBe(theme === 'dark')
  expect(document.documentElement.style.colorScheme).toBe(theme)
  expect(host.classList.contains('theme-light')).toBe(false)
  return host
}
async function clickText(root: ParentNode, text: string) {
  const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.includes(text))
  expect(button, text).toBeDefined(); button!.click(); await flush()
}
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('contratos HU-163', () => {
  it('conserva absolutamente todos los tokens anteriores y define nuevos claros exactos', () => {
    for (const [theme, values] of Object.entries(baseline)) for (const [name, value] of Object.entries(values)) expect((theme === 'light' ? lightTokens : darkTokens)[name as keyof typeof lightTokens]).toBe(value)
    for (const [name, value] of Object.entries(added)) { expect(lightTokens[name as keyof typeof lightTokens]).toBe(value); expect(darkTokens[name as keyof typeof lightTokens]).toMatch(/^#[\dA-F]{6}$/) }
    expect(Object.keys(baseline164.light).length - Object.keys(baseline.light).length).toBe(17)
    const css = readFileSync('assets/css/theme.css', 'utf8')
    for (const [name, value] of Object.entries(added)) expect(css).toContain(`--brand-${name}: ${rgbChannels(value)} !important;`)
  })
  it('audita el alcance completo y mantiene protegidas las rutas ajenas', () => {
    for (const file of routes) { expect(migratedThemeFiles).toContain(file); expect(readFileSync(file, 'utf8')).toContain('darkReady: true') }
    expect(contentNeedsLight({ darkReady: true })).toBe(false)
    for (const file of ['pages/disenador.vue', 'pages/facturacion/index.vue']) expect(readFileSync(file, 'utf8')).not.toContain('darkReady: true')
    expect(contentNeedsLight({})).toBe(true)
    expect(auditThemeColors()).toEqual([])
  })
  it('conserva documentos, QR y logos de datos dentro del alcance claro', () => {
    const source = readFileSync('pages/ajustes/index.vue', 'utf8')
    expect(source.match(/class="theme-light/g)).toHaveLength(3)
    expect(source).toContain(':src="logoSrc"')
    expect(source).toContain('Vista previa en correos')
    expect(readFileSync('components/SettingsProfile.vue', 'utf8')).toContain('class="theme-light h-36 w-36')
    expect(readFileSync('components/PrintReportPage.vue', 'utf8')).toContain('theme-light')
    // No hay selector de color de marca en el TenantResponse ni en la pantalla actual.
    expect(source).not.toContain('type="color"')
  })
  it('los controles nativos heredan el esquema y los conmutadores conservan el pulgar blanco', () => {
    for (const file of ['pages/roles/index.vue', 'pages/platform/plans.vue', 'components/SettingsProfile.vue', 'components/SettingsApiKeys.vue']) expect(readFileSync(file, 'utf8')).toContain('color-scheme: inherit')
    for (const file of ['pages/usuarios/index.vue', 'pages/usuarios/[id].vue', 'pages/roles/index.vue']) expect(readFileSync(file, 'utf8')).toContain('bg-brand-switch-thumb')
  })
})

describe.each(['light', 'dark'])('montajes HU-163 sin red, tema %s', theme => {
  it.each(['perfil', 'seguridad', 'plan', 'organizacion', 'identidad', 'regional', 'facturacion', 'integraciones', 'grupos'])('ajustes sección %s', async section => {
    const host = await mount('pages/ajustes/index.vue', theme, {}, section)
    expect(host.querySelector('.settings-page')).not.toBeNull()
    expect(host.querySelectorAll('.theme-light')).toHaveLength(section === 'identidad' ? 3 : 0)
    if (section === 'identidad') expect(host.querySelector('img[alt="Logo en correos"]')?.closest('.theme-light')).not.toBeNull()
  })
  it('perfil conserva edición y seguridad conserva QR claro y validación del código', async () => {
    const profile = await mount('components/SettingsProfile.vue', theme, { mode: 'profile' })
    await clickText(profile, 'Editar perfil')
    expect(profile.querySelector('input')?.classList.contains('bg-brand-surface')).toBe(true)
    const security = await mount('components/SettingsProfile.vue', theme, { mode: 'security' })
    const qr = 'data:image/png;base64,cXI='
    vi.stubGlobal('$fetch', vi.fn(async () => ({ secret: 'SIMULADO', qrCodeDataUrl: qr })))
    await clickText(security, 'Activar 2FA')
    expect(security.querySelector('img')?.getAttribute('src')).toBe(qr)
    expect(security.querySelector('img')?.classList.contains('theme-light')).toBe(true)
    expect(security.querySelector('img')?.classList.contains('bg-brand-surface')).toBe(true)
    expect([...security.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('Verificar y activar'))?.disabled).toBe(true)
  })
  it('sesiones muestra dispositivo y confirmación con superficie del tema', async () => {
    const host = await mount('components/SettingsSessions.vue', theme)
    expect(host.textContent).toContain('Chrome en Windows')
    host.querySelector<HTMLButtonElement>('[aria-label^="Cerrar sesión en"]')!.click(); await flush()
    expect(host.querySelector('[role="dialog"] .bg-brand-surface')).not.toBeNull()
  })
  it('API mantiene modal teletransportado, permisos deshabilitados y campos de captura', async () => {
    const host = await mount('components/SettingsApiKeys.vue', theme, { personal: true })
    await clickText(host, 'Generar API key')
    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(dialog.closest('.theme-light')).toBeNull()
    expect(dialog.querySelector('input[type="date"]')?.classList.contains('bg-brand-surface')).toBe(true)
    expect(dialog.querySelectorAll('input[type="checkbox"]:disabled')).toHaveLength(3)
  })
  it('correo conserva configuración y diálogos; integración fiscal conserva estado vacío', async () => {
    const host = await mount('components/SettingsEmailAccordion.vue', theme)
    await clickText(host, 'Correo saliente')
    await clickText(host, 'Configurar valores personalizados')
    expect(host.querySelector('input')?.classList.contains('bg-brand-surface')).toBe(true)
    const fiscal = await mount('components/SettingsFiscalModuleMapping.vue', theme)
    expect(fiscal.querySelector('select')?.classList.contains('bg-brand-surface')).toBe(true)
  })
  it('grupos conserva vacío, modal y selección nativa de integrantes', async () => {
    const host = await mount('components/SettingsNotificationGroups.vue', theme)
    expect(host.textContent).toContain('Todavía no hay grupos')
    await clickText(host, 'Nuevo grupo')
    expect(host.querySelector('[role="dialog"]')?.classList.contains('bg-brand-surface')).toBe(true)
    const checkbox = host.querySelector<HTMLInputElement>('[type="checkbox"]')!
    checkbox.click(); await flush(); expect(checkbox.checked).toBe(true)
  })
  it('plan y consumo conserva tarjetas, barras y estados vacíos; consumo del agente no llama IA', async () => {
    const host = await mount('components/SettingsBillingSummary.vue', theme)
    expect(host.querySelector('.plan-card')).not.toBeNull()
    expect(host.querySelector('.segmented-storage')).not.toBeNull()
    expect(host.textContent).toContain('Aún no hay cobros')
    const usage = await mount('components/AgentUsageTable.vue', theme, { allowed: true })
    expect(usage.textContent).toContain('Todavía no hay uso del agente')
  })
  it('usuarios muestra estados e invitación; detalle conserva rol, acceso y pulgar', async () => {
    const host = await mount('pages/usuarios/index.vue', theme)
    expect(host.textContent).toContain('Ana')
    await clickText(host, 'Invitar usuario')
    expect(host.querySelector('#invite-email')?.classList.contains('bg-brand-surface')).toBe(true)
    const detail = await mount('pages/usuarios/[id].vue', theme)
    await clickText(detail, 'Acceso')
    expect(detail.querySelector('select')?.classList.contains('bg-brand-surface')).toBe(true)
    expect(detail.querySelector('.bg-brand-switch-thumb')).not.toBeNull()
  })
  it('roles distingue concedido mediante marca y aria; alternar conserva permisos', async () => {
    const host = await mount('pages/roles/index.vue', theme)
    const boxes = host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')
    expect(boxes).toHaveLength(5)
    expect(boxes[0]!.getAttribute('aria-checked')).toBe('true')
    expect(boxes[0]!.querySelector('svg')).not.toBeNull()
    expect(boxes[1]!.getAttribute('aria-checked')).toBe('false')
    expect(boxes[1]!.querySelector('svg')).toBeNull()
    boxes[1]!.click(); await flush()
    expect(boxes[1]!.getAttribute('aria-checked')).toBe('true')
    expect(boxes[1]!.querySelector('svg')).not.toBeNull()
  })
  it('administración de planes conserva editor, opciones nativas y excepciones vacías', async () => {
    const host = await mount('pages/platform/plans.vue', theme)
    expect(host.textContent).toContain('Starter')
    expect(host.textContent).toContain('Sin excepciones activas')
    expect(host.querySelector('select')?.classList.contains('bg-brand-surface')).toBe(true)
  })
  it('importación conserva carga y error sin sustituir su protocolo CSV', async () => {
    const host = await mount('pages/registros/[entity]/importar.vue', theme)
    expect(host.querySelector('input[type="file"]')?.getAttribute('accept')).toBe('.csv,text/csv')
    expect(host.textContent).toContain('Solo archivos .csv')
    expect(host.querySelector('.theme-light')).toBeNull()
    const error = await mount('pages/registros/[entity]/importar.vue', theme, {}, undefined, { useEntityFields: async () => ({ data: ref(null), pending: ref(false), error: ref(new Error('simulado')) }) })
    expect(error.textContent).toContain('No se pudo cargar la definición')
  })
  it('importación conserva vista previa, columnas desconocidas, envío y tabla de errores', async () => {
    const host = await mount('pages/registros/[entity]/importar.vue', theme)
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File(['titulo,extra\nCita,valor\n'], 'citas.csv', { type: 'text/csv' })
    Object.defineProperty(input, 'files', { value: [file] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    for (let i = 0; i < 20 && !host.querySelector('table'); i++) await flush()
    expect(host.querySelector('table')?.textContent).toContain('Cita')
    expect(host.textContent).toContain('se ignorarán: extra')
    const fetcher = vi.fn(async () => ({ insertedCount: 0, errors: [{ row: 2, error: 'Fila inválida' }] }))
    vi.stubGlobal('$fetch', fetcher)
    await clickText(host, 'Importar 1 fila')
    expect(fetcher).toHaveBeenCalledWith('/api/records/citas/import', { method: 'POST', body: { rows: [{ titulo: 'Cita', extra: 'valor' }] } })
    expect(host.textContent).toContain('Fila inválida')
    expect(host.querySelectorAll('table')).toHaveLength(2)
    expect(host.querySelectorAll('.theme-light')).toHaveLength(0)
  })
  it('confirmación destructiva conserva acción, cancelación y foreground apropiado', async () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn() })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn() })
    const confirm = vi.fn(), cancel = vi.fn()
    const host = await mount('components/SettingsConfirmDialog.vue', theme, { title: 'Eliminar', confirmLabel: 'Eliminar', destructive: true, onConfirm: confirm, onCancel: cancel })
    expect(host.querySelector('dialog')?.classList.contains('bg-brand-surface')).toBe(true)
    expect(host.querySelector('.bg-brand-error-text')?.classList.contains('text-brand-error-fg')).toBe(true)
    await clickText(host, 'Eliminar'); expect(confirm).toHaveBeenCalledOnce()
    await clickText(host, 'Cancelar'); expect(cancel).toHaveBeenCalledOnce()
  })
  it('organización conserva vacío y creación local de grupos', async () => {
    const host = await mount('pages/organizacion.vue', theme)
    expect(host.textContent).toContain('El menú empieza con un grupo')
    await clickText(host, 'Crear primer grupo')
    expect(host.querySelector('#group-name')?.classList.contains('bg-brand-surface')).toBe(true)
    expect(host.querySelector('.theme-light')).toBeNull()
  })
})
