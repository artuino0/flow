// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createApp, h, nextTick, reactive, ref, type Component, type App } from 'vue'
import { collectFieldRefs, parseExpression } from '~/utils/calcExpression'
import { slugifyIdentifier } from '~/utils/slugify'
import { OPTION_COLORS, colorDotClass } from '~/utils/optionColors'
import { designerFieldFormSource } from '~/utils/designerFieldForm'
import type { Blueprint } from '~/server/utils/blueprint/schema'
import * as catalogUtils from '~/utils/fieldValidationCatalog'
import { describeFieldValidations } from '~/server/utils/fieldValidations/registry'
import { compileVueComponent } from '../helpers/vueComponent'

const require = createRequire(import.meta.url)
const descriptor = parse(readFileSync('components/FieldFormModal.vue', 'utf8')).descriptor
const compiled = compileScript(descriptor, { id: 'field-form-151', inlineTemplate: true })
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const apps: App[] = []
const fetch = vi.fn(async (url: string) => url === '/api/field-validations' ? describeFieldValidations() : url === '/api/entities' ? { entities: [{ id: 'real', slug: 'real', name: 'Real' }] } : { fields: [] })
const confirm = vi.fn(async () => true)
function mount(overrides: Record<string, unknown> = {}) {
  const exports: { default?: Component } = {}
  const parameter = compileVueComponent('components/FieldValidationParameter.vue', { '~/utils/fieldValidationCatalog': catalogUtils })
  const loader = (id: string) => id === '~/utils/calcExpression' ? { collectFieldRefs, parseExpression } : id === '~/utils/optionColors' ? { OPTION_COLORS, colorDotClass } : id === '~/utils/fieldValidationCatalog' ? catalogUtils : id === '~/components/FieldValidationParameter.vue' ? { default: parameter } : require(id)
  new Function('require', 'exports', 'useConfirm', '$fetch', 'slugifyIdentifier', 'OPTION_COLORS', 'colorDotClass', code)(loader, exports, () => ({ confirm, dialog: ref(null) }), fetch, slugifyIdentifier, OPTION_COLORS, colorDotClass)
  const props = reactive({ open: false, mode: 'create', hasValues: false, ...overrides })
  const submit = vi.fn()
  const close = vi.fn(() => { props.open = false })
  const host = document.createElement('div'); document.body.append(host)
  const app = createApp({ render: () => h(exports.default!, { ...props, onSubmit: submit, onClose: close }) })
  app.component('FieldValidationParameter', parameter)
  app.mount(host); apps.push(app)
  return { host, props, submit, close }
}
async function open(props: { open: boolean }) { props.open = true; await nextTick(); await nextTick() }
function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === label)
  if (!found) throw new Error(`No se encontró ${label}`)
  return found
}
async function input(host: HTMLElement, id: string, value: string) {
  const field = host.querySelector<HTMLInputElement>(id)!
  field.value = value; field.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
}
const blueprint: Blueprint = { version: 1, summary: 'Plano', associations: [], modules: [
  { ref: 'ventas', slug: 'ventas', name: 'Ventas', action: 'create', kind: 'hecho', fields: [{ name: 'precio', label: 'Precio', dataType: 'number' }, { name: 'cliente', label: 'Cliente', dataType: 'relation', validationRules: { relationEntity: 'clientes' } }] },
  { ref: 'clientes', slug: 'clientes', name: 'Clientes', action: 'extend', kind: 'dimension', fields: [{ name: 'nombre', label: 'Nombre', dataType: 'text' }] }
] }
const source = designerFieldFormSource(null, blueprint)
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; vi.clearAllMocks() })
describe('FieldFormModal en diseñador y editor original', () => {
  it('el editor original conserva carga del tenant, nombre bloqueado y payload', async () => {
    const { host, props, submit } = mount({ mode: 'edit', initialField: { name: 'cliente', label: 'Cliente', dataType: 'relation', isRequired: true, validationRules: { relationEntity: 'real' } } })
    await open(props)
    expect(fetch).toHaveBeenCalledWith('/api/entities')
    expect(host.querySelector<HTMLInputElement>('#field-name')!.disabled).toBe(true)
    button(host, 'Guardar campo').click(); await nextTick()
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ name: 'cliente', isRequired: true, validationRules: { relationEntity: 'real' } }))
  })
  it('carga relaciones, tablas y cálculos desde el plano sin fetch', async () => {
    const { host, props, submit } = mount({ fieldSource: source, entityId: 'ventas', existingFields: source.fieldsByEntity.ventas, initialField: { name: 'importe', label: 'Importe', dataType: 'number', isRequired: false, validationRules: { calculation: { kind: 'expression', expression: 'precio * 2' } } } })
    await open(props)
    expect(button(host, 'precio').title).toBe('Precio')
    button(host, 'Agregar campo').click(); await nextTick()
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ validationRules: { calculation: { kind: 'expression', expression: 'precio * 2' } } }))
    button(host, 'Cambiar').click(); await nextTick()
    button(host, 'Relación').click(); await nextTick()
    expect([...host.querySelectorAll('option')].map(item => item.value)).toContain('clientes')
    button(host, 'Cambiar').click(); await nextTick()
    button(host, 'Tabla').click(); await nextTick()
    expect(fetch.mock.calls.every(([url]) => url === '/api/field-validations')).toBe(true)
  })
  it('ofrece copyFrom y prefijos de módulos propuestos sin API', async () => {
    const { host, props } = mount({ fieldSource: source, entityId: 'ventas', existingFields: source.fieldsByEntity.ventas,
      initialField: { name: 'items', label: 'Items', dataType: 'tabla', isRequired: false, validationRules: { columns: [
        { name: 'cliente', label: 'Cliente', type: 'relation', relationEntity: 'clientes' },
        { name: 'nombre', label: 'Nombre', type: 'text', copyFrom: 'clientes.nombre' }
      ] } } })
    await open(props)
    expect([...host.querySelectorAll('option')].map(item => item.value)).toContain('clientes.nombre')
    button(host, 'Cambiar').click(); await nextTick()
    button(host, 'Incremental').click(); await nextTick()
    button(host, 'Con prefijo de relación').click(); await nextTick()
    const picker = [...host.querySelectorAll('select')].find(item => [...item.options].some(option => option.value === 'cliente'))!
    picker.value = 'cliente'; picker.dispatchEvent(new Event('change', { bubbles: true })); await nextTick()
    expect([...host.querySelectorAll('option')].map(item => item.value)).toContain('nombre')
    expect(fetch.mock.calls.every(([url]) => url === '/api/field-validations')).toBe(true)
  })
  it('resuelve acumulados hacia módulos propuestos y sus campos numéricos', async () => {
    const { host, props, submit } = mount({ fieldSource: source, entityId: 'clientes', existingFields: source.fieldsByEntity.clientes,
      initialField: { name: 'ventas_total', label: 'Total', dataType: 'number', isRequired: false, validationRules: { calculation: { kind: 'rollup', sourceEntity: 'ventas', relationField: 'cliente', aggregate: 'sum', valueField: 'precio' } } } })
    await open(props)
    expect([...host.querySelectorAll('option')].map(item => item.value)).toEqual(expect.arrayContaining(['ventas', 'cliente', 'precio']))
    button(host, 'Agregar campo').click(); await nextTick()
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ validationRules: { calculation: { kind: 'rollup', sourceEntity: 'ventas', relationField: 'cliente', aggregate: 'sum', valueField: 'precio' } } }))
    expect(fetch.mock.calls.every(([url]) => url === '/api/field-validations')).toBe(true)
  })
  it('permite editar propuestas y conserva reglas sin control visual', async () => {
    const { host, props, submit } = mount({ fieldSource: source, mode: 'edit', allowSchemaEditing: true, initialField: { name: 'codigo', label: 'Código', dataType: 'text', isRequired: true, validationRules: { format: 'lettersOnly', minLength: 2 } } })
    await open(props)
    expect(host.querySelector<HTMLInputElement>('#field-name')!.disabled).toBe(false)
    await input(host, '#field-name', 'codigo_nuevo')
    button(host, 'Guardar campo').click(); await nextTick()
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ name: 'codigo_nuevo', isRequired: true, validationRules: { format: 'lettersOnly', minLength: 2 } }))
  })
  it('deshabilita existentes y no ofrece guardar', async () => {
    const { host, props, submit } = mount({ fieldSource: source, readOnly: true, mode: 'edit', initialField: { name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: true, validationRules: {} } })
    await open(props)
    expect(host.querySelector('fieldset')!.disabled).toBe(true)
    expect(host.textContent).toContain('Este campo ya existe; los campos existentes no se pueden cambiar desde el diseñador')
    expect([...host.querySelectorAll('button')].some(item => item.textContent?.includes('Guardar campo'))).toBe(false)
    expect(submit).not.toHaveBeenCalled()
  })
  it('mantiene abierto si se cancela el descarte y atrapa Tab', async () => {
    confirm.mockResolvedValueOnce(false)
    const { host, props, close } = mount({ fieldSource: source })
    await open(props)
    await input(host, '#field-label', 'Cambio')
    host.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick(); await nextTick()
    expect(close).not.toHaveBeenCalled()
    expect(props.open).toBe(true)
    // jsdom no realiza layout; simula controles visibles para probar el ciclo.
    for (const item of host.querySelectorAll<HTMLElement>('button, input, select, textarea')) {
      vi.spyOn(item, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList)
    }
    const first = host.querySelector<HTMLButtonElement>('button')!
    const last = button(host, 'Agregar campo')
    last.focus()
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(first)
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(last)
  })
  it('confirma el descarte con Esc y devuelve el foco a la fila', async () => {
    const row = document.createElement('button'); document.body.append(row); row.focus()
    const { host, props, close } = mount({ fieldSource: source })
    await open(props)
    expect(host.contains(document.activeElement)).toBe(true)
    await input(host, '#field-label', 'Campo cambiado')
    host.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick(); await nextTick(); await nextTick()
    expect(confirm).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(row)
  })
})
