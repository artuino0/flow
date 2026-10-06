// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { readFileSync } from 'node:fs'
import { compileVueComponent } from '../helpers/vueComponent'
import { darkTokens, lightTokens } from '../../utils/themeTokens'
import { contrast } from '../helpers/themeContrast'
import { auditThemeSource } from '../../scripts/auditThemeColors'

const apps: vue.App[] = []
afterEach(() => { for (const app of apps.splice(0)) app.unmount(); document.body.replaceChildren() })
const flush = async () => { for (let i = 0; i < 10; i++) { await Promise.resolve(); await vue.nextTick() } }
async function mount(file: string, admin = true, error = false) {
  const meta = vi.fn(), fetch = vi.fn(async () => ({ url: 'https://stripe.test/simulado', provider: 'smtp', durationMs: 7 }))
  const user = vue.ref({ isAdmin: admin, tenantName: 'Organización con un nombre largo de prueba', accountLifecycle: { phase: 'pending_deletion', reason: 'payment_due', deleteAt: '2027-01-01T00:00:00Z' } })
  const globals = { ...vue, definePageMeta: meta, useAuth: () => ({ user, logout: vi.fn(), fetchMe: vi.fn() }), $fetch: fetch, navigateTo: vi.fn(),
    useFetch: () => ({ data: vue.ref({ policy: { graceDays: 7, retentionDays: 180, warningDays: [30,7,1] }, deletionEnabled: false, organizations: [{ id: 'test', name: 'Organización sintética', account: { phase: 'pending_deletion', reason: 'payment_due', deleteAt: '2027-01-01' }, holdReason: 'mandatory_notice_pending' }], exports: [{ id: 'pending', status: 'pending', url: null }, { id: 'failed', status: 'failed', error: 'Solicita exportación asistida.' }] }), error: vue.ref(error ? new Error('Sintético') : null), status: vue.ref('success'), refresh: vi.fn() }) }
  const component = compileVueComponent(file, {}, globals)
  const stub = { template: '<a><slot /></a>' }, host = document.createElement('div'); document.body.append(host)
  const app = vue.createApp({ render: () => vue.h(vue.Suspense, null, { default: () => vue.h(component) }) })
  app.component('NuxtLink', stub); app.component('AccountPayment', { template: '<section>Contratar de nuevo</section>' }); app.component('AccountExport', { template: '<section>Exportar tus datos</section>' }); apps.push(app); app.mount(host); await flush()
  return { host, meta, fetch }
}
describe('191: interfaz sin navegador; DOM, tokens y composición responsive', () => {
  it('integración conserva navegación de cuentas y diagnóstico/envío de correo de plataforma', async () => {
    const { host, fetch } = await mount('pages/platform/index.vue')
    expect(host.textContent).toContain('Ciclo de vida de las cuentas')
    expect(host.textContent).toContain('Planes y límites')
    expect(host.textContent).toContain('Proveedor activo')
    const testMail = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Enviar correo de prueba'))!
    expect(testMail).toBeTruthy(); testMail.click(); await flush()
    expect(fetch).toHaveBeenCalledWith('/api/platform/mail/test', { method: 'POST' })
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Correo de prueba aceptado por smtp')
  })
  it.each(['light','dark','system'])('modos %s a 1440 y 390: contenido y acciones presentes', async mode => {
    document.documentElement.dataset.theme = mode === 'system' ? 'dark' : mode
    for (const width of [1440,390]) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      const account = await mount('pages/cuenta-suspendida.vue')
      expect(account.meta).toHaveBeenCalledWith({ layout: false, darkReady: true })
      expect(account.host.textContent).toContain('La cuenta está suspendida'); expect(account.host.textContent).toContain('UTC'); expect(account.host.textContent).toContain('Exportar tus datos')
      expect([...account.host.querySelectorAll('button')].map(button => button.textContent)).toContain('Pagar o reactivar')
      const platform = await mount('pages/platform/accounts.vue')
      expect(platform.meta).toHaveBeenCalledWith({ layout: false, darkReady: true })
      expect(platform.host.textContent).toContain('desactivado'); expect(platform.host.textContent).toContain('Borrado pospuesto'); expect(platform.host.querySelectorAll('label').length).toBeGreaterThan(4)
    }
  })
  it('miembro ve contacto al administrador, sin pago ni exportación', async () => {
    const { host } = await mount('pages/cuenta-suspendida.vue', false)
    expect(host.textContent).toContain('Contacta al administrador'); expect(host.textContent).not.toContain('Pagar o reactivar'); expect(host.textContent).not.toContain('Exportar tus datos')
  })
  it('exportación comunica espera y errores, botones accesibles', async () => {
    const { host } = await mount('components/AccountExport.vue', true, true)
    expect(host.textContent).toContain('100 MiB'); expect(host.textContent).toContain('24 horas'); expect(host.textContent).toContain('Preparando archivo'); expect(host.querySelector('[role=alert]')).not.toBeNull()
    expect(host.querySelectorAll('button')).toHaveLength(2)
  })
  it('colores nuevos auditados, contraste de texto y botones, reglas para columnas y acciones', () => {
    for (const file of ['pages/cuenta-suspendida.vue','pages/platform/accounts.vue','pages/platform/index.vue','pages/exportar.vue','components/AccountExport.vue','components/AccountPayment.vue']) expect(auditThemeSource(file, readFileSync(file,'utf8'))).toEqual([])
    for (const tokens of [lightTokens,darkTokens]) for (const [fg,bg] of [['text','bg'],['text-secondary','bg'],['primary-fg','navy'],['navy','bg']] as const) expect(contrast(tokens[fg],tokens[bg])).toBeGreaterThanOrEqual(4.5)
    expect(readFileSync('pages/platform/accounts.vue','utf8')).toContain('md:grid-cols-2')
    expect(readFileSync('pages/cuenta-suspendida.vue','utf8')).toContain('flex-wrap:wrap')
  })
})
