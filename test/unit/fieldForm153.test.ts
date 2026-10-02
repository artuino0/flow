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
const dateComponent = compileVueComponent('components/FieldDateValue.vue', { '~/utils/relativeDate': relativeDate, '~/utils/fieldValueFormat': fieldValueFormat }, { useAuth: () => ({ user: ref({ timezone: 'America/Mexico_City' }) }) })
const modal = compileVueComponent('components/FieldFormModal.vue', {
  '~/utils/calcExpression': calcExpression, '~/utils/fieldValidationCatalog': catalogUtils,
  '~/utils/optionColors': { OPTION_COLORS, colorDotClass },
  '~/components/FieldValidationParameter.vue': { default: parameter },
  '~/components/FieldDateValue.vue': { default: dateComponent }, '~/utils/relativeDate': relativeDate
}, { useAuth: () => ({ user: ref({ timezone: 'America/Mexico_City' }) }), $fetch: fetcher, slugifyIdentifier, OPTION_COLORS, colorDotClass, useConfirm: () => ({ confirm, dialog: ref(null) }) })
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
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('Modal HU-153 real', () => {
  it.each([false, true])('vista previa en vivo y popover accesible, diseñador=%s', async designer => {
    const { host, props, close } = mount({ mode: 'edit', initialField: initial('date'), ...(designer ? { fieldSource: { entities: [], fieldsByEntity: {} } } : {}) })
    await open(props)
    const section = host.querySelector<HTMLElement>('[data-date-presentation]')!
    const required = [...host.querySelectorAll('p')].find(p => p.textContent === 'Campo obligatorio')!.parentElement!.parentElement!
    for (const token of ['rounded', 'border', 'border-brand-border-light', 'p-3']) {
      expect(required.classList.contains(token)).toBe(true)
      expect(section.classList.contains(token)).toBe(true)
    }
    expect(section.classList.contains('bg-brand-bg')).toBe(required.classList.contains('bg-brand-bg'))
    expect(section.parentElement!.classList.contains('gap-5')).toBe(true)
    expect(section.previousElementSibling!.hasAttribute('data-validations')).toBe(true)
    expect(section.classList.contains('gap-5')).toBe(true)
    expect(section.querySelector('h3')!.className).toBe(host.querySelector('label[for="add-validation"]')!.className)
    expect(section.querySelector('#date-format')!.className).toBe(host.querySelector('#add-validation')!.className)
    expect(section.querySelector('#date-format')!.parentElement!.classList.contains('gap-1.5')).toBe(true)
    const toggle = section.querySelector<HTMLButtonElement>('#date-show-relative')!
    expect(toggle.getAttribute('role')).toBe('switch')
    expect(toggle.getAttribute('aria-labelledby')).toBe('date-show-relative-label')
    expect(section.querySelector('#date-show-relative-label')!.textContent).toBe('Mostrar tiempo relativo')
    expect(section.querySelector(`#${toggle.getAttribute('aria-describedby')}`)!.textContent).toBe('Agrega cuánto falta o cuánto pasó junto a la fecha.')
    expect(toggle.classList.contains('focus:ring-1')).toBe(true)
    const previewBox = section.querySelector('[data-date-preview]')!
    expect(previewBox.querySelector('p')!.textContent).toBe('Así se verá')
    expect(previewBox.classList.contains('bg-brand-bg')).toBe(true)
    const rows = [...previewBox.querySelectorAll('[data-date-preview-row]')]
    expect(rows.map(row => row.querySelector('dt')!.textContent)).toEqual(['Fecha pasada', 'Fecha futura'])
    for (const row of rows) {
      expect(row.classList.contains('grid-cols-1')).toBe(true)
      expect(row.classList.contains('sm:grid-cols-[auto_minmax(0,1fr)]')).toBe(true)
      expect(row.querySelector('dd')!.classList.contains('break-words')).toBe(true)
    }
    const choices = [...host.querySelector<HTMLSelectElement>('#date-format')!.options]
    const days = relativeDate.datePreviewDays(new Date(), 'America/Mexico_City')
    expect(choices.map(o => o.text)).toEqual(['short', 'medium', 'long'].map(format => `${({ short: 'Corta', medium: 'Intermedia', long: 'Larga' })[format]} · ${relativeDate.formattedFieldDate(days.today, format as relativeDate.FieldDateFormat)}`))
    for (const format of ['short', 'medium', 'long'] as const) {
      await change(host, '#date-format', format)
      const preview = host.querySelector('[data-date-preview]')!
      expect(preview.textContent).toContain(relativeDate.formattedFieldDate(days.past, format))
      expect(preview.textContent).toContain(relativeDate.formattedFieldDate(days.future, format))
      expect(preview.textContent).not.toContain('hace 12 días')
      expect(toggle.getAttribute('aria-checked')).toBe('false')
      expect(rows.map(row => row.querySelector('dd')!.textContent)).toEqual([days.past, days.future].map(day => relativeDate.formattedFieldDate(day, format)))
      host.querySelector<HTMLButtonElement>('#date-show-relative')!.click(); await flush()
      expect(toggle.getAttribute('aria-checked')).toBe('true')
      expect(rows[0].querySelector('dd')!.textContent).toBe(`${relativeDate.formattedFieldDate(days.past, format)} · hace 12 días`)
      expect(rows[1].querySelector('dd')!.textContent).toBe(`${relativeDate.formattedFieldDate(days.future, format)} · en 1 mes`)
      expect(rows[0].querySelector('dd span span')!.classList.contains('text-brand-text-secondary')).toBe(true)
      expect(preview.textContent).toContain('hace 12 días'); expect(preview.textContent).toContain('en 1 mes')
      expect(preview.querySelector('span')!.getAttribute('aria-label')).toContain(relativeDate.formattedFieldDate(days.past, 'long'))
      host.querySelector<HTMLButtonElement>('#date-show-relative')!.click(); await flush()
    }
    const help = host.querySelector<HTMLButtonElement>('[aria-controls="date-presentation-help"]')!
    expect(help.textContent).toBe('')
    expect(help.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(help.getAttribute('aria-label')).toBe('Ayuda sobre presentación de fechas')
    expect(help.classList.contains('h-8')).toBe(true); expect(help.classList.contains('w-8')).toBe(true)
    expect(help.classList.contains('border')).toBe(false)
    expect(help.parentElement!.classList.contains('justify-between')).toBe(true)
    help.focus()
    // jsdom no sintetiza el click nativo de Enter/Espacio: se reproduce su evento sin puntero (detail=0).
    help.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    help.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })); await flush()
    expect(help.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('#date-presentation-help')!.textContent).toContain('el dato guardado no cambia')
    expect(host.querySelector('#date-presentation-help')!.parentElement).toBe(host.querySelector('[role="dialog"]'))
    expect(section.contains(host.querySelector('#date-presentation-help'))).toBe(false)
    host.querySelector<HTMLElement>('#date-presentation-help')!.click(); await flush()
    expect(help.getAttribute('aria-expanded')).toBe('true')
    help.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await flush()
    expect(help.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(help); expect(close).not.toHaveBeenCalled()
    help.click(); await flush(); document.body.click(); await flush()
    expect(host.querySelector('#date-presentation-help')).toBeNull(); expect(document.activeElement).toBe(help)
    help.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    help.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })); await flush()
    expect(help.getAttribute('aria-expanded')).toBe('true')
    props.open = false; await flush()
    expect(host.querySelector('#date-presentation-help')).toBeNull()
  })
  it('ancla la ayuda dentro del ancho del modal pequeño, recoloca con scroll/resize y limpia al cambiar tipo', async () => {
    const { host, props } = mount({ mode: 'edit', initialField: initial('date') }); await open(props)
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!
    const help = host.querySelector<HTMLButtonElement>('[aria-controls="date-presentation-help"]')!
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 16, right: 344 } as DOMRect)
    const anchor = vi.spyOn(help, 'getBoundingClientRect').mockReturnValue({ right: 320, top: 100, bottom: 132 } as DOMRect)
    vi.stubGlobal('innerWidth', 360)
    vi.stubGlobal('innerHeight', 640)
    help.click(); await flush()
    const panel = host.querySelector<HTMLElement>('#date-presentation-help')!
    expect(panel.classList.contains('fixed')).toBe(true)
    expect(panel.style.width).toBe('304px'); expect(panel.style.left).toBe('28px'); expect(panel.style.top).toBe('140px')
    expect(Number.parseFloat(panel.style.left) + Number.parseFloat(panel.style.width)).toBeLessThanOrEqual(332)
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ height: 150 } as DOMRect)
    anchor.mockReturnValue({ right: 320, top: 560, bottom: 592 } as DOMRect)
    dialog.dispatchEvent(new Event('scroll')); await flush()
    expect(panel.style.top).toBe('auto'); expect(panel.style.bottom).toBe('88px')
    anchor.mockReturnValue({ right: 300, top: 100, bottom: 132 } as DOMRect)
    window.dispatchEvent(new Event('resize')); await flush()
    expect(panel.style.top).toBe('140px')
    await click(host, 'Cambiar'); await click(host, 'Texto')
    expect(host.querySelector('[data-date-presentation]')).toBeNull()
    expect(host.querySelector('#date-presentation-help')).toBeNull()
    anchor.mockClear(); window.dispatchEvent(new Event('resize')); dialog.dispatchEvent(new Event('scroll'))
    expect(anchor).not.toHaveBeenCalled()
  })
  it('reorganizar presentación conserva el campo y todas sus reglas guardadas', async () => {
    const rules = { dateFormat: 'long', showRelative: true, min: '2026-01-01', antigua: 'conservar' }
    const field = initial('date', rules)
    const { host, props, submit } = mount({ mode: 'edit', initialField: field }); await open(props)
    const help = host.querySelector<HTMLButtonElement>('[aria-controls="date-presentation-help"]')!
    help.click(); await flush(); help.click(); await flush()
    await click(host, 'Guardar campo')
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ name: field.name, label: field.label, dataType: 'date', isRequired: false, validationRules: rules }))
    expect(field.validationRules).toEqual(rules)
  })
  it.each(['absolute', 'both', 'relative'])('convierte %s heredado al guardar sin display', async display => {
    const { host, props, submit } = mount({ mode: 'edit', initialField: initial('date', { display }) })
    await open(props); await click(host, 'Guardar campo')
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ validationRules: { dateFormat: 'short', showRelative: display !== 'absolute' } }))
  })
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
  it('after/before solo ofrecen otras Fechas propias y presentación se guarda desde el catálogo en diseñador', async () => {
    const own = [initial('date'), { ...initial('date'), id: 'inicio', name: 'inicio', label: 'Inicio' }, { ...initial('text'), id: 'texto', name: 'texto' }]
    const { host, props, submit } = mount({ mode: 'edit', initialField: initial('date'), fieldSource: { entities: [], fieldsByEntity: {} }, existingFields: own, hasValues: true })
    await open(props)
    await change(host, '#add-validation', 'after')
    expect([...host.querySelector<HTMLSelectElement>('#validation-after')!.options].map(o => o.value)).toEqual(['', 'inicio'])
    await change(host, '#add-validation', 'before')
    expect([...host.querySelector<HTMLSelectElement>('#validation-before')!.options].map(o => o.value)).toEqual(['', 'inicio'])
    await change(host, '#date-format', 'medium')
    host.querySelector<HTMLButtonElement>('#date-show-relative')!.click(); await flush()
    await click(host, 'Guardar campo')
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ validationRules: { after: 'inicio', before: 'inicio', dateFormat: 'medium', showRelative: true } }))
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
  it('sin configuración conserva presentación previa y siempre ofrece la fecha larga accesible', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const props = reactive({ value: '2026-10-01T20:30:00Z' as unknown, rules: {} })
    const app = createApp({ render: () => h(dateComponent, props) }); app.mount(host); apps.push(app)
    expect(host.textContent).toBe(fieldValueFormat.formatDate(String(props.value)))
    expect(host.querySelector('span')!.title).toBe('1 de octubre de 2026, 14:30')
    props.value = ''; await flush(); expect(host.textContent).toBe('—')
    props.value = '2026-02-30'; props.rules = { dateFormat: 'short', showRelative: true }; await flush()
    expect(host.textContent).toBe('Fecha inválida')
    expect(host.querySelector('span')!.getAttribute('aria-label')).toBe('Fecha inválida')
    props.value = '2026-02-30T14:30:00Z'; await flush(); expect(host.textContent).toBe('Fecha inválida')
  })
  it('renderiza relativa con fecha exacta accesible, both y absolute, sin temporizador', async () => {
    const date = compileVueComponent('components/FieldDateValue.vue', { '~/utils/relativeDate': relativeDate, '~/utils/fieldValueFormat': fieldValueFormat }, { useAuth: () => ({ user: ref({ timezone: 'America/Mexico_City' }) }) })
    const props = reactive({ value: '2026-09-19', rules: { display: 'relative' }, now: new Date('2026-10-01T18:00:00Z') })
    const host = document.createElement('div'); document.body.append(host)
    const app = createApp({ render: () => h(date, props) }); app.mount(host); apps.push(app)
    expect(host.textContent).toBe('19/09/2026 · hace 12 días'); expect(host.querySelector('span')!.title).toContain('19 de septiembre de 2026')
    expect(host.querySelector('span')!.getAttribute('aria-label')).toContain('19 de septiembre de 2026')
    props.rules.display = 'both'; await flush(); expect(host.textContent).toContain('19/09/2026 · hace 12 días')
    props.rules.display = 'absolute'; await flush(); expect(host.textContent).not.toContain('hace')
    for (const file of ['DynamicTable', 'RecordDetailView', 'RecordKanbanBoard']) expect(readFileSync(`components/${file}.vue`, 'utf8')).toContain('<FieldDateValue')
    expect(readFileSync('components/DynamicForm.vue', 'utf8')).not.toContain('FieldDateValue')
  })
})
