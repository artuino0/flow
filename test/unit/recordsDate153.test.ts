// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, reactive, ref, watch, type App } from 'vue'
import { compileVueComponent } from '../helpers/vueComponent'
import * as relativeDates from '~/utils/relativeDate'
import * as fieldValueFormat from '~/utils/fieldValueFormat'
import type { EntityFieldMeta } from '~/composables/useEntityFields'
import * as clientValidation from '~/utils/validateFieldValue'
import * as fieldValues from '~/utils/fieldValue'
const apps: App[] = []
const dateValue = compileVueComponent('components/FieldDateValue.vue', { '~/utils/relativeDate': relativeDates, '~/utils/fieldValueFormat': fieldValueFormat }, { useAuth: () => ({ user: ref({ timezone: 'America/Mexico_City' }) }) })
// Congela la hora por prop sin modificar el reloj ni el valor de registros.
const frozenDate = defineComponent({ props: ['value', 'rules'], setup: p => () => h(dateValue, { ...p, now: new Date('2026-10-01T18:00:00Z') }) })
const globals = { computed, ref, watch, useConfirm: () => ({ confirm: vi.fn(async () => true) }), useToast: () => ({ success: vi.fn(), error: vi.fn() }), useAuth: () => ({ user: ref({ timezone: 'America/Mexico_City' }) }), useIsAdmin: () => ({ data: ref(false) }), labelForRecord: () => 'Registro', formatDate: fieldValueFormat.formatDate }
afterEach(() => { apps.splice(0).forEach(a => a.unmount()); document.body.innerHTML = '' })
describe('Fecha de registros en las tres vistas reales', () => {
  it('DynamicForm mantiene input Fecha exacta y Texto libre heredado; normaliza al salir y valida con el catálogo', async () => {
    const fields: EntityFieldMeta[] = [
      { id: 'fecha', name: 'fecha', label: 'Fecha', dataType: 'date', validationRules: { display: 'relative' }, isRequired: false },
      { id: 'texto', name: 'texto', label: 'Texto', dataType: 'text', validationRules: { pattern: '[', enum: ['otro'], trim: true, case: 'upper', minLength: 4 }, isRequired: false }
    ]
    const model = reactive({ value: { fecha: '2026-09-19', texto: ' Ana ' } as Record<string, unknown> })
    const instance = ref<{ validateAll: () => boolean } | null>(null)
    const form = compileVueComponent('components/DynamicForm.vue', { '~/utils/validateFieldValue': clientValidation, '~/utils/fieldValue': fieldValues }, { ref, computed, validateFieldValue: clientValidation.validateFieldValue })
    const host = document.createElement('div'); document.body.append(host)
    const app = createApp({ render: () => h(form, { fields, entityId: 'entidad', modelValue: model.value, 'onUpdate:modelValue': (v: Record<string, unknown>) => { model.value = v }, ref: instance }) })
    for (const tag of ['DynamicTableField', 'DynamicSelectField', 'DynamicRelationField', 'DynamicFileField', 'DynamicUserField']) app.component(tag, { render: () => null })
    app.mount(host); apps.push(app)
    expect(host.querySelector<HTMLSelectElement>('#field-texto')?.tagName).toBe('INPUT')
    expect(host.querySelector<HTMLInputElement>('#field-fecha')!.value).toBe('2026-09-19')
    host.querySelector('#field-texto')!.dispatchEvent(new Event('blur')); await nextTick()
    expect(model.value.texto).toBe('ANA')
    expect(instance.value!.validateAll()).toBe(false); await nextTick()
    expect(host.textContent).toContain('Longitud mínima: Cantidad mínima de caracteres.')
    expect(model.value.fecha).toBe('2026-09-19')
  })
  it.each(['DynamicTable', 'RecordDetailView', 'RecordKanbanBoard'])('%s respeta relative/both y nunca altera el dato original', async name => {
    const fields: EntityFieldMeta[] = [{ id: 'fecha', name: 'fecha', label: 'Fecha', dataType: 'date', validationRules: { display: 'relative' }, isRequired: false }]
    const row = { id: 'registro', customData: { fecha: '2026-09-19' }, updatedAt: '2026-10-01T18:00:00Z' }
    const table = { entitySlug: 'pruebas', fields, rows: [row], page: 1, pageSize: 10, total: 1, sortBy: 'fecha', sortDir: 'asc', permissions: { canRead: true, canCreate: false, canUpdate: false, canDelete: false } }
    const detail = { entityId: 'entidad', entitySlug: 'pruebas', entityName: 'Pruebas', fields, record: row, layout: { properties: [{ name: 'fecha', visible: true }], relations: [], showActivity: false }, inverseRelations: [] }
    const board = { entitySlug: 'pruebas', fields, columns: [{ key: 'nuevo', label: 'Nuevo', records: [row], total: 1 }], config: { enabled: true, statusField: 'estado', titleField: 'titulo', secondaryFields: ['fecha'], defaultView: 'board' }, canUpdate: false }
    const component = compileVueComponent(`components/${name}.vue`, {}, globals)
    const host = document.createElement('div'); document.body.append(host)
    const props = name === 'DynamicTable' ? table : name === 'RecordDetailView' ? detail : board
    const app = createApp({ render: () => h(component, props) })
    app.component('FieldDateValue', frozenDate)
    for (const tag of ['NuxtLink', 'RecordAssociationsPanel', 'RecordActivityTimeline', 'DynamicFileValue', 'RecordLinesTable', 'DynamicForm']) app.component(tag, { render: () => null })
    app.mount(host); apps.push(app)
    await nextTick()
    expect(host.textContent).toContain('hace 12 días')
    expect(host.querySelector('[title*="19 de septiembre"]')).not.toBeNull()
    expect(row.customData.fecha).toBe('2026-09-19')
    // Prop reactiva real mediante un remount con el mismo registro.
    app.unmount(); apps.pop(); fields[0].validationRules.display = 'both'
    const next = createApp({ render: () => h(component, props) })
    next.component('FieldDateValue', frozenDate)
    for (const tag of ['NuxtLink', 'RecordAssociationsPanel', 'RecordActivityTimeline', 'DynamicFileValue', 'RecordLinesTable', 'DynamicForm']) next.component(tag, { render: () => null })
    next.mount(host); apps.push(next); await nextTick()
    expect(host.textContent).toContain('19/09/2026 · hace 12 días')
    expect(row.customData.fecha).toBe('2026-09-19')
    for (const format of ['short', 'medium', 'long'] as const) for (const showRelative of [true, false]) {
      apps.pop()!.unmount()
      fields[0].validationRules = { dateFormat: format, showRelative }
      // También ejercita el título del Kanban con un campo Fecha.
      board.config.titleField = 'fecha'
      const rendered = createApp({ render: () => h(component, props) })
      rendered.component('FieldDateValue', frozenDate)
      for (const tag of ['NuxtLink', 'RecordAssociationsPanel', 'RecordActivityTimeline', 'DynamicFileValue', 'RecordLinesTable', 'DynamicForm']) rendered.component(tag, { render: () => null })
      rendered.mount(host); apps.push(rendered); await nextTick()
      expect(host.textContent).toContain(relativeDates.formattedFieldDate(row.customData.fecha, format))
      expect(host.textContent!.includes('hace 12 días')).toBe(showRelative)
      expect(host.querySelector('[aria-label*="19 de septiembre de 2026"]')).not.toBeNull()
      expect(row.customData).toEqual({ fecha: '2026-09-19' })
    }
  })
})
