// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, ref, type App } from 'vue'
import { compileVueComponent } from '../helpers/vueComponent'
import * as catalogUtils from '~/utils/fieldValidationCatalog'
import * as calcExpression from '~/utils/calcExpression'
import * as relativeDate from '~/utils/relativeDate'
import * as fieldValueFormat from '~/utils/fieldValueFormat'
import { describeFieldValidations } from '~/server/utils/fieldValidations/registry'
import { slugifyIdentifier } from '~/utils/slugify'
import { OPTION_COLORS, colorDotClass } from '~/utils/optionColors'
import { readFileSync } from 'node:fs'

const apps: App[] = []
const parameter = compileVueComponent('components/FieldValidationParameter.vue', { '~/utils/fieldValidationCatalog': catalogUtils })
const confirm = vi.fn(async () => true)
const fetcher = vi.fn(async () => describeFieldValidations())
const modal = compileVueComponent('components/FieldFormModal.vue', {
  '~/utils/calcExpression': calcExpression, '~/utils/fieldValidationCatalog': catalogUtils,
  '~/utils/optionColors': { OPTION_COLORS, colorDotClass },
  '~/components/FieldValidationParameter.vue': { default: parameter }
}, { $fetch: fetcher, slugifyIdentifier, OPTION_COLORS, colorDotClass, useConfirm: () => ({ confirm, dialog: ref(null) }) })
function mount(overrides: Record<string, unknown> = {}) {
  const props = reactive({ open: false, mode: 'create', hasValues: false, ...overrides })
  const submit = vi.fn(); const close = vi.fn()
  const host = document.createElement('div'); document.body.append(host)
  const app = createApp({ render: () => h(modal, { ...props, onSubmit: submit, onClose: close }) })
  app.component('FieldValidationParameter', parameter); app.mount(host); apps.push(app)
  return { host, props, submit, close }
}
async function flush() { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick() }
async function open(props: { open: boolean }) { props.open = true; await flush() }
async function click(host: HTMLElement, text: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text)
  expect(button, text).toBeDefined(); button!.click(); await flush()
}
async function change(host: HTMLElement, id: string, value: string, event = 'change') {
  const el = host.querySelector<HTMLInputElement | HTMLSelectElement>(id)!
  expect(el, id).toBeDefined(); el.value = value; el.dispatchEvent(new Event(event, { bubbles: true })); await flush()
}
const initial = (type = 'text', rules: Record<string, unknown> = {}) => ({ name: 'valor', label: 'Valor', dataType: type, isRequired: false, validationRules: rules })
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; vi.clearAllMocks() })
describe('Modal HU-153 real', () => {
  it('en create el tipo se elige libremente y colapsa; defaults, booleanos y límites vienen del catálogo', async () => {
    const { host, props } = mount(); await open(props)
    expect(host.querySelector('[data-type-grid]')).not.toBeNull()
    await click(host, 'Número'); expect(host.querySelector('[data-type-grid]')).toBeNull()
    await change(host, '#add-validation', 'maxDecimals')
    const input = host.querySelector<HTMLInputElement>('#validation-maxDecimals')!
    expect(input.value).toBe('2'); expect(input.max).toBe('15'); expect(input.step).toBe('1')
    await change(host, '#validation-maxDecimals', '16', 'input')
    expect(input.getAttribute('aria-invalid')).toBe('true'); expect(host.textContent).toContain('Máximo: 15')
    await change(host, '#validation-maxDecimals', '3', 'input')
    await change(host, '#add-validation', 'integer')
    expect(host.querySelector<HTMLSelectElement>('#validation-integer')!.value).toBe('true')
    await change(host, '#validation-integer', 'false')
    expect(host.querySelector<HTMLSelectElement>('#validation-integer')!.value).toBe('false')
  })
  it('colapsa al elegir, reabre con foco y advierte al cambiar tipo vacío', async () => {
    const { host, props, submit } = mount({ mode: 'edit', initialField: initial('text', { minLength: 2 }) })
    await open(props); expect(host.querySelector('[data-type-grid]')).toBeNull()
    await click(host, 'Cambiar'); expect(host.querySelector('[data-type-grid]')).not.toBeNull()
    expect(host.textContent).toContain('las reglas del tipo anterior se descartarán')
    expect(host.querySelector('[data-type-grid]')!.contains(document.activeElement)).toBe(true)
    await click(host, 'Número'); expect(host.querySelector('[data-type-grid]')).toBeNull()
    await click(host, 'Guardar campo')
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ dataType: 'number', validationRules: {} }))
  })
  it('bloquea tipo y selección múltiple con valores; deja agregar/etiquetar/color y protege opciones en uso', async () => {
    const { host, props, submit } = mount({ mode: 'edit', hasValues: true, usedOptionValues: ['a'], initialField: initial('select', { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }) })
    await open(props)
    expect(host.textContent).toContain('Este campo ya tiene datos; el tipo no se puede cambiar')
    expect([...host.querySelectorAll('button')].some(b => b.textContent === 'Cambiar')).toBe(false)
    expect(host.querySelector<HTMLInputElement>('[aria-label="Valor interno de A"]')!.disabled).toBe(true)
    const remove = host.querySelector<HTMLButtonElement>('[title="Opción en uso: no se puede quitar"]')!
    expect(remove.disabled).toBe(true)
    await click(host, 'Selección múltiple')
    await click(host, 'Agregar opción')
    const labels = host.querySelectorAll<HTMLInputElement>('[placeholder="Etiqueta"]')
    labels[2].value = 'C'; labels[2].dispatchEvent(new Event('input', { bubbles: true })); await flush()
    labels[0].value = 'Nueva A'; labels[0].dispatchEvent(new Event('input', { bubbles: true })); await flush()
    host.querySelector<HTMLButtonElement>('[title="Quitar opción"]')!.click(); await flush()
    await click(host, 'Guardar campo')
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ dataType: 'select', validationRules: { options: [{ value: 'a', label: 'Nueva A', color: 'neutral' }, { value: 'c', label: 'C', color: 'neutral' }] } }))
  })
  it('select agrega/quita reglas aplicables, parámetros y límites; formato muestra ejemplo', async () => {
    const { host, props, submit } = mount({ initialField: initial() }); await open(props)
    const choices = [...host.querySelector<HTMLSelectElement>('#add-validation')!.options].map(o => o.value)
    expect(choices).toContain('format'); expect(choices).not.toContain('minRows'); expect(choices).not.toContain('pattern')
    await change(host, '#add-validation', 'format')
    expect(host.textContent).toContain('ana@example.com')
    expect([...host.querySelector<HTMLSelectElement>('#add-validation')!.options].map(o => o.value)).not.toContain('format')
    await change(host, '#validation-format', 'postalCodeMx'); expect(host.textContent).toContain('01234')
    await change(host, '#add-validation', 'minLength')
    expect(host.querySelector<HTMLInputElement>('#validation-minLength')!.min).toBe('0')
    await change(host, '#validation-minLength', '-1', 'input')
    expect(host.textContent).toContain('Mínimo: 0')
    await click(host, 'Agregar campo'); expect(submit).not.toHaveBeenCalled()
    await change(host, '#validation-minLength', '3', 'input')
    host.querySelector<HTMLButtonElement>('[aria-label="Quitar Formato guiado"]')!.click(); await flush()
    expect(document.activeElement?.id).toBe('add-validation')
    await click(host, 'Agregar campo')
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ validationRules: { minLength: 3 } }))
  })
  it('after/before solo ofrecen otras Fechas propias y display se guarda desde el catálogo en diseñador', async () => {
    const own = [initial('date'), { ...initial('date'), id: 'inicio', name: 'inicio', label: 'Inicio' }, { ...initial('text'), id: 'texto', name: 'texto' }]
    const { host, props, submit } = mount({ mode: 'edit', initialField: initial('date'), fieldSource: { entities: [], fieldsByEntity: {} }, existingFields: own, hasValues: true })
    await open(props)
    await change(host, '#add-validation', 'after')
    expect([...host.querySelector<HTMLSelectElement>('#validation-after')!.options].map(o => o.value)).toEqual(['', 'inicio'])
    await change(host, '#add-validation', 'before')
    expect([...host.querySelector<HTMLSelectElement>('#validation-before')!.options].map(o => o.value)).toEqual(['', 'inicio'])
    await change(host, '#date-display', 'both')
    await click(host, 'Guardar campo')
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ validationRules: { after: 'inicio', before: 'inicio', display: 'both' } }))
    expect(host.textContent).not.toContain('Este campo ya tiene datos')
  })
  it('conserva reglas desconocidas para que el servidor decida; muestra su error claro', async () => {
    const { host, props, submit } = mount({ mode: 'edit', initialField: initial('text', { pattern: '[', antigua: true }), error: 'Texto no admite pattern ni enum; usa un formato guiado o Select' })
    await open(props); await click(host, 'Guardar campo')
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ validationRules: { pattern: '[', antigua: true } }))
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Texto no admite pattern ni enum')
  })
})
describe('Presentación compartida en vistas de registros', () => {
  it('renderiza relativa con fecha exacta accesible, both y absolute, sin temporizador', async () => {
    const date = compileVueComponent('components/FieldDateValue.vue', { '~/utils/relativeDate': relativeDate, '~/utils/fieldValueFormat': fieldValueFormat }, { useAuth: () => ({ user: ref({ timezone: 'America/Mexico_City' }) }) })
    const props = reactive({ value: '2026-09-19', rules: { display: 'relative' }, now: new Date('2026-10-01T18:00:00Z') })
    const host = document.createElement('div'); document.body.append(host)
    const app = createApp({ render: () => h(date, props) }); app.mount(host); apps.push(app)
    expect(host.textContent).toBe('hace 12 días'); expect(host.querySelector('span')!.title).toContain('19 sep')
    expect(host.querySelector('span')!.getAttribute('aria-label')).toContain('19 sep')
    props.rules.display = 'both'; await flush(); expect(host.textContent).toContain('hace 12 días (19 sep')
    props.rules.display = 'absolute'; await flush(); expect(host.textContent).not.toContain('hace')
    for (const file of ['DynamicTable', 'RecordDetailView', 'RecordKanbanBoard']) expect(readFileSync(`components/${file}.vue`, 'utf8')).toContain('<FieldDateValue')
    expect(readFileSync('components/DynamicForm.vue', 'utf8')).not.toContain('FieldDateValue')
  })
})
