// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue'
import { compileVueComponent } from '../helpers/vueComponent'
import * as badges from '~/utils/fieldTypeBadge'
const apps: App[] = []
afterEach(() => { apps.splice(0).forEach(a => a.unmount()); document.body.innerHTML = '' })
describe('Aviso persistente de impacto y uso previo al guardar', () => {
  it.each([false, true])('muestra incumplimientos y truncamiento=%s después de cerrar modal', async truncated => {
    const field = { id: 'f1', name: 'nombre', label: 'Nombre', dataType: 'text', validationRules: {}, isRequired: false }
    const draft = { ...field, validationRules: { minLength: 3 } }
    const modal = defineComponent({ props: ['open', 'hasValues', 'usedOptionValues', 'loadingUsage'], emits: ['submit'], setup: (p, { emit }) => () => p.open ? h('button', { id: 'save-draft', disabled: p.loadingUsage, 'data-has-values': String(p.hasValues), onClick: () => emit('submit', draft) }, 'Guardar') : null })
    const impactModal = defineComponent({ props: ['open'], emits: ['confirm'], setup: (p, { emit }) => () => p.open ? h('button', { id: 'confirm-impact', onClick: () => emit('confirm') }, 'Confirmar') : null })
    const fetcher = vi.fn(async (_url: string, options?: { method: string }) => options?.method === 'PUT' ? { validationImpact: { nonCompliantRecords: 4, truncated } } : { hasValues: true, usedOptionValues: [], affectedRecords: 0 })
    const card = compileVueComponent('components/ModuleFieldsCard.vue', {
      '~/components/FieldFormModal.vue': { default: modal }, '~/components/FieldImpactWarningModal.vue': { default: impactModal }, '~/utils/fieldTypeBadge': badges
    }, { $fetch: fetcher, useToast: () => ({ success: vi.fn(), updated: vi.fn(), error: vi.fn() }), useConfirm: () => ({ confirm: vi.fn(async () => true) }) })
    const host = document.createElement('div'); document.body.append(host)
    const app = createApp({ render: () => h(card, { entityId: 'entity', entityName: 'Clientes', fields: [field] }) })
    app.component('ModuleTourHelpButton', { render: () => null }); app.mount(host); apps.push(app)
    host.querySelector<HTMLButtonElement>('[title="Editar"]')!.click()
    for (let i = 0; i < 6; i++) await nextTick()
    expect(host.querySelector('#save-draft')!.getAttribute('data-has-values')).toBe('true')
    expect(fetcher).toHaveBeenCalledWith('/api/entity-fields/f1')
    host.querySelector<HTMLButtonElement>('#save-draft')!.click()
    for (let i = 0; i < 10; i++) await nextTick()
    expect(host.querySelector('#save-draft')).toBeNull()
    expect(host.querySelector('[role="status"]')!.textContent).toContain('4 registros existentes no cumplen la nueva regla; se conservan sin cambios y se validarán al editarlos')
    expect(host.textContent?.includes('conteo truncado')).toBe(truncated)
    host.querySelector<HTMLButtonElement>('[data-tour="manual-field-add"]')!.click(); await nextTick()
    expect(host.querySelector('[role="status"]')).not.toBeNull()
  })
})
