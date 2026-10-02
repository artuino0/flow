import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { compile } from '@vue/compiler-dom'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { designerWarningGroups, designerWarningTopic, groupDesignerWarningItems, type DesignerWarningItem } from '../../utils/designerWarnings'
import { designerChatEntries } from '../../utils/designerChat'
import { designerOmissionsSchema, extractDesignerOmissions } from '../../server/utils/moduleDesigner/coverage'
import { runDesignerGeneration } from '../../server/utils/moduleDesigner/generate'
import { validateBlueprintAgainstSnapshot } from '../../server/utils/blueprint/validate'
import type { Blueprint } from '../../server/utils/blueprint/schema'
import { designerCapabilityWarningItems, designerClassifiedWarningItem } from '../../server/utils/moduleDesigner/capabilities'

const empty: Blueprint = { version: 1, summary: 'Vacío', modules: [], associations: [] }
const auto = (name: string) => `Omití la asociación «${name}» porque ese vínculo ya está expresado por un campo relación o Usuario.`
const requested = [
  ['Aviso de seguimiento programado', 'No hay avisos por tiempo.', 'unsupported'],
  ['Recordatorios de propuestas', 'No hay notificaciones programadas.', 'unsupported'],
  ['Avisos de vencimientos', 'No hay avisos por tiempo.', 'unsupported'],
  ['Vistas por responsable', 'Se configuran en Listado de registros.', 'elsewhere'],
  ['Dashboard de ventas', 'No se crean dashboards desde aquí.', 'unsupported'],
  ['Fecha del último seguimiento calculada', 'No hay cálculos entre fechas.', 'unsupported'],
  ['Días sin contacto', 'No hay diferencias de fechas.', 'unsupported'],
  ['Bloquear Ganado hasta que exista una propuesta aceptada', 'Las reglas entre módulos no expresan esa condición.', 'unsupported'],
  ['Impedir un motivo de pérdida cuando la etapa no sea Perdido', 'No hay reglas condicionales para esa condición.', 'unsupported'],
  ['Registros iniciales de los catálogos', 'Carga sus valores después de crear los módulos.', 'pending']
] as const
// La descripción de la captura enumera diez elementos en nueve líneas: los dos cálculos comparten una.
const captureItems: DesignerWarningItem[] = [
  ...['Prospectos y seguimientos', 'Propuestas', 'Industrias', 'Fuentes', 'Planes', 'Motivos de pérdida', 'Usuarios'].map(name => ({ kind: 'auto' as const, text: auto(name) })),
  ...requested.filter((_, index) => index !== 6).map(([item, reason, kind], index) => ({ kind, text: `${item}${index === 5 ? ' y Días sin contacto' : ''} — ${reason}` }))
]

async function renderGroups(items: DesignerWarningItem[]) {
  const source = readFileSync('pages/disenador.vue', 'utf8')
  const start = source.indexOf('            <div v-if="message.role === \'assistant\' && message.warningItems')
  const end = source.indexOf('            <div v-if="message.draft?.status', start)
  expect(start).toBeGreaterThan(0)
  const { code } = compile(source.slice(start, end), { mode: 'function' })
  const render = new Function('Vue', code)(Vue)
  return renderToString(Vue.createSSRApp({ render, setup: () => ({ message: { role: 'assistant', warningItems: items }, designerWarningGroups }) }))
}

describe('ERD-159: avisos del diseñador', () => {
  it('reparte capacidades reales en elsewhere y carencias reales en unsupported', () => {
    for (const item of ['Vistas de tabla', 'Dashboard', 'Tablero', 'Reportes', 'Avisos al crear registros', 'Notificaciones al actualizar registros', 'Triggers al borrar registros']) {
      const warning = designerClassifiedWarningItem('unsupported', item, 'No quedó completo: este diseñador no lo crea.')
      expect(warning.kind).toBe('elsewhere')
      expect(warning.text).not.toContain('No quedó completo')
      expect(warning.text).toContain(' — ')
    }
    for (const item of ['Cálculo con fecha actual', 'Diferencias entre fechas', 'Avisos programados por tiempo', 'Disparadores programados', 'Reglas condicionales entre módulos', 'Vistas guardadas', 'Dashboard propio', 'Dashboard de ventas']) {
      expect(designerClassifiedWarningItem('elsewhere', item).kind).toBe('unsupported')
    }
    expect(designerClassifiedWarningItem('different', 'Vistas', 'Sin kind válido.').kind).toBe('different')
    expect(designerCapabilityWarningItems('Vistas, dashboards, reportes y avisos al crear registros').every(item => item.kind === 'elsewhere')).toBe(true)
    expect(designerCapabilityWarningItems('Vistas guardadas y dashboards propios').every(item => item.kind === 'unsupported')).toBe(true)
    expect(designerCapabilityWarningItems('Disparadores programados por tiempo')[0]?.kind).toBe('unsupported')
    expect(readFileSync('utils/flowApps.ts', 'utf8')).toContain("label: 'Automatización'")
    expect(readFileSync('components/AppNav.vue', 'utf8')).toContain("label: 'Flujos', to: '/triggers'")
    expect(readFileSync('components/ModuleListLayoutCard.vue', 'utf8')).toContain('Listado de registros')
    expect(readFileSync('pages/reportes/nuevo.vue', 'utf8')).toContain('Reportes')
  })

  it('elsewhere queda plegado con otros grupos aunque haya tres líneas, y abierto si es el único', async () => {
    const items: DesignerWarningItem[] = [{ kind: 'pending', text: 'Cargar valores.' }, { kind: 'unsupported', text: 'Cálculo con fechas.' }, { kind: 'elsewhere', text: 'Reportes.' }]
    const groups = designerWarningGroups(items)
    expect(groups.map(group => [group.kind, group.open])).toEqual([['unsupported', true], ['elsewhere', false], ['pending', true]])
    expect((await renderGroups(items)).match(/<details[^>]*\bopen/g)).toHaveLength(2)
    expect(designerWarningGroups([{ kind: 'elsewhere', text: 'Reportes.' }])[0]?.open).toBe(true)
    expect(await renderGroups([{ kind: 'elsewhere', text: 'Reportes.' }])).toMatch(/<details[^>]*\bopen/)
    const ordered = designerWarningGroups([{ kind: 'different', text: 'Campo simple.' }, ...items])
    expect(ordered.map(group => group.kind)).toEqual(['different', 'unsupported', 'elsewhere', 'pending'])
  })

  it('no confunde avisos por eventos con avisos programados en capacidades', () => {
    const event = groupDesignerWarningItems(designerCapabilityWarningItems('Quiero avisos al crear registros'))
    expect(event[0]?.topic).toBe('event-notifications')
    expect(event[0]?.kind).toBe('elsewhere')
    expect(event[0]?.details?.[0]).toContain('Automatización')
    const scheduled = groupDesignerWarningItems(designerCapabilityWarningItems('Quiero avisos programados'))
    expect(scheduled[0]?.topic).toBe('scheduled-notifications')
    expect(scheduled[0]?.details?.[0]).toContain('no están disponibles')
    expect(designerCapabilityWarningItems('Avisos al crear registros y recordatorios programados por tiempo').map(item => item.kind)).toEqual(['unsupported', 'elsewhere'])
  })

  it('cuenta los alias silenciosos de iconos sin añadir avisos ni cambiar el resultado', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const blueprint: Blueprint = { ...empty, modules: [{ ref: 'clientes', slug: 'clientes', name: 'Clientes', action: 'create', kind: 'dimension', icon: 'shopping-cart', fields: [] }] }
      const result = await runDesignerGeneration({ current: empty, blueprint: empty, conversation: [], instruction: 'Clientes', complete: async () => ({ value: { message: 'CRM', blueprint }, model: 'simulado', inputTokens: 1, outputTokens: 1 }), validate: input => validateBlueprintAgainstSnapshot(input, empty) })
      expect(result.valid).toBe(true)
      expect(result.warnings).toEqual([])
      expect(result.warningItems).toEqual([])
      expect(result.result?.normalized?.modules[0]?.icon).toBe('ShoppingCart')
      expect(log.mock.calls.map(call => JSON.parse(String(call[0])))).toEqual([expect.objectContaining({ level: 'info', autoAdjustments: 1, types: ['icon-normalization'] })])
    } finally { log.mockRestore() }
  })

  it('reconstruye las 16 líneas en cuatro temas y un paso del usuario, sin ajustes visibles', () => {
    expect(captureItems).toHaveLength(16)
    const groups = designerWarningGroups(captureItems)
    expect(groups.map(group => [group.kind, group.count, group.open])).toEqual([['unsupported', 4, false], ['elsewhere', 1, false], ['pending', 1, false]])
    expect(groups[0]!.items.map(item => item.topic)).toEqual(['scheduled-notifications', 'views', 'date-calculations', 'cross-module-rules'])
    const details = groups.flatMap(group => group.items.flatMap(item => item.details ?? [item.text])).join('\n')
    for (const [item] of requested) expect(details).toContain(item)
    expect(details).not.toContain('Omití')
    expect(details).not.toContain('No quedó completo')
  })

  it('fusiona solo unsupported con un tema inequívoco y conserva motivos distintos', () => {
    const items: DesignerWarningItem[] = [
      { kind: 'unsupported', text: 'Avisos programados — Para llamadas.' },
      { kind: 'unsupported', text: 'Avisos programados — Para llamadas.' },
      { kind: 'unsupported', text: 'Avisos programados — Para visitas.' },
      { kind: 'unsupported', text: 'Vistas por vendedor — Sin vistas.' },
      { kind: 'unsupported', text: 'Fecha de compra — Pendiente.' },
      { kind: 'different', text: 'Avisos programados — Campo simple.' }
    ]
    const grouped = groupDesignerWarningItems(items)
    expect(grouped).toHaveLength(4)
    expect(grouped[0]?.details).toEqual(['Avisos programados — Para llamadas.', 'Avisos programados — Para visitas.'])
    expect(groupDesignerWarningItems(grouped)).toEqual(grouped)
    expect(designerWarningTopic('Fecha de compra')).toBeUndefined()
    expect(designerWarningTopic('Regla para módulos nuevos')).toBeUndefined()
    expect(designerWarningTopic('NOTIFICACIÓN PROGRAMADA')).toBe('scheduled-notifications')
  })

  it('kind ausente o inválido sigue siendo compatible y no relaja textos ni objetos', () => {
    const omissions = designerOmissionsSchema.parse(requested.map(([item, reason, kind]) => ({ item, reason, kind })))
    expect(omissions[0]?.kind).toBe('unsupported')
    for (const kind of [undefined, 'otro', null, {}, { toString: 'inválido' }]) {
      const parsed = designerOmissionsSchema.parse([{ item: 'Campo', reason: 'Simple.', ...(kind === undefined ? {} : { kind }) }])
      expect(parsed[0]?.kind ?? 'different').toBe('different')
    }
    const extracted = extractDesignerOmissions({ blueprint: { omissions: [{ item: 'Campo', reason: 'DROP TABLE users', kind: 'unsupported' }, { item: 'Campo', reason: 'Simple.', kind: 'pending', extra: true }] } })
    expect(extracted).toEqual({ blueprint: {}, omissions: [] })
    expect(extractDesignerOmissions({ omitted: [{ item: 'Campo', reason: 'Simple.', kind: 'pending' }] })).toEqual({ omissions: [{ item: 'Campo', reason: 'Simple.', kind: 'pending' }] })
  })

  it('conserva mensajes antiguos como lista y limpia ajustes de contenido y explicación', () => {
    const warning = auto('Clientes')
    const [entry] = designerChatEntries([{ role: 'assistant', content: `CRM\n${warning}`, explanation: `CRM\n- **Ajuste automático:** ${warning}\nDecisión.`, warnings: [warning, 'Revisa el campo.'], createdAt: '2026-01-01' }], [])
    expect(entry?.warnings).toEqual(['Revisa el campo.'])
    expect(entry?.warningItems).toBeUndefined()
    expect(entry?.content).toBe('CRM')
    expect(entry?.explanation).toBe('CRM\nDecisión.')
    const user = designerChatEntries([{ role: 'user', content: warning, createdAt: '2026-01-01' }], [])
    expect(user[0]?.content).toBe(warning)
  })

  it('renderiza details nativo, temas, contadores, orden y umbral sin navegador', async () => {
    const closed = await renderGroups(captureItems)
    expect(closed.match(/<details/g)).toHaveLength(3)
    expect(closed).not.toMatch(/<details[^>]*\bopen/)
    expect(closed).toContain('Todavía no disponible en Flow (4)')
    expect(closed).toContain('Te toca a ti (1)')
    expect(closed).toContain('Avisos programados')
    const items: DesignerWarningItem[] = [{ kind: 'pending', text: 'Cargar valores.' }, { kind: 'different', text: 'Campo simple.' }, { kind: 'unsupported', text: 'Función nueva.' }]
    const opened = await renderGroups(items)
    expect(opened.match(/<details[^>]*\bopen/g)).toHaveLength(3)
    expect(opened.indexOf('Quedó diferente')).toBeLessThan(opened.indexOf('Todavía no disponible'))
    expect(opened.indexOf('Quedó diferente')).toBeLessThan(opened.indexOf('Te toca a ti'))
    expect(opened.match(/<summary/g)).toHaveLength(3)
    expect(opened).toContain('focus-visible:outline')
    expect(await renderGroups([{ kind: 'auto', text: auto('Clientes') }])).not.toContain('<details')
  })

  it('genera y registra ajustes sin nombres, conserva plano válido y etiqueta omisiones', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const blueprint: Blueprint = { ...empty, modules: [{ ref: 'clientes', slug: 'clientes', name: 'Clientes privados', action: 'create', kind: 'dimension', fields: [] }, { ref: 'pedidos', slug: 'pedidos', name: 'Pedidos privados', action: 'create', kind: 'hecho', fields: [{ name: 'cliente', label: 'Cliente privado', dataType: 'relation', validationRules: { relationEntity: 'clientes' } }] }], associations: [{ name: 'Vínculo privado', sourceRef: 'pedidos', targetRef: 'clientes' }] }
    const complete = vi.fn(async (_options: { system: string; prompt: string }) => ({ value: { message: 'CRM', blueprint, omissions: requested.map(([item, reason, kind]) => ({ item, reason, kind })) }, model: 'simulado', inputTokens: 1, outputTokens: 1 }))
    try {
      const result = await runDesignerGeneration({ current: empty, blueprint: empty, conversation: [], instruction: 'CRM', complete, validate: input => validateBlueprintAgainstSnapshot(input, empty) })
      expect(result.valid).toBe(true)
      expect(result.result?.normalized?.associations).toEqual([])
      expect(result.result?.normalized?.modules[1]?.fields[0]?.dataType).toBe('relation')
      expect(result.warnings).toHaveLength(13)
      expect(result.message).toBe('CRM')
      expect(result.explanation).not.toMatch(/Omití|icono genérico|Ajuste automático/)
      expect(designerWarningGroups(result.warningItems).map(group => group.count)).toEqual([4, 1, 1])
      const logs = log.mock.calls.map(call => JSON.parse(String(call[0])))
      expect(logs).toEqual([expect.objectContaining({ message: 'designer_validation', level: 'info', autoAdjustments: 3, types: ['icon-normalization', 'redundant-association'] })])
      expect(JSON.stringify(logs)).not.toContain('privado')
      expect(complete).toHaveBeenCalledTimes(1)
      expect(complete.mock.calls[0]![0].system).toContain('Nunca declares omitido algo ya cubierto')
      expect(complete.mock.calls[0]![0].system).toContain('pending')
      const entries = designerChatEntries([{ role: 'assistant', content: result.message, warnings: result.warnings, warningItems: result.warningItems, createdAt: '2026-01-01' }], [])
      expect(entries[0]?.warningItems).toEqual(result.warningItems)
    } finally { log.mockRestore() }
  })
})
