import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { agentHistory, resolveAgentFollowup, type AgentAction, type AgentMessageReference } from '../../utils/agentConversation'
import { validateAgentActions } from '../../utils/chattitoCatalog'
import { agentBody, agentPrompt, cheapAgentReply, parseAgentOutput } from '../../server/utils/agent/layers'
import { travelCatalog } from '../fixtures/agentTravelCatalog'
const access = { isAdmin: true, designerAvailable: true }
const context = { page: 'home', path: '/' }
const module = travelCatalog.find(module => module.slug === 'servicios')!
const path = `/modulos/${module.id}/editar?tab=fields`
const navigate: AgentAction = { kind: 'navigate', path, moduleId: module.id, label: 'Llévame a Campos de Servicios' }
const messages: AgentMessageReference[] = [
 { role: 'assistant', text: 'Crear servicio', actions: [{ kind: 'navigate', path: '/registros/servicios/nuevo' }] },
 { role: 'user', text: 'Quiero configurar cupos' },
 { role: 'assistant', text: 'Puedes guardar un cupo como dato; eso no limita automáticamente las citas.', actions: [navigate] }
]
describe('ERD-145 referente local, sin servidor ni cuota', () => {
 it.each(['llévame', 'llévame ahí', 'llévame allá', 'vamos', 'vamos allá', 'dale', 'sí', 'ok llévame', 'a eso', 'ahí', 'muéstramelo', 'ábrelo', '¡LLÉVAME!, por favor', 'dale gracias'])('%s conserva el último destino', async text => {
  const endpoint = vi.fn(), run = vi.fn()
  const result = resolveAgentFollowup(text, messages)
  if (result?.action) await run(result.action)
  else if (!result) endpoint()
  expect(result?.reply.reply).toBe('¡Vamos!')
  expect(run).toHaveBeenCalledExactlyOnceWith(navigate)
  expect(endpoint).not.toHaveBeenCalled()
 })
 it.each(['llévame y dime cuánto cuesta', 'vamos a Campos de Servicios', 'sí pero tengo otra duda', 'muéstramelo y dime el precio', 'enséñame a crear un módulo', 'porfa llévame gracias'])('no captura una pregunta real: %s', text => {
  expect(resolveAgentFollowup(text, messages)).toBeNull()
 })
 it('elige por verbo y prioriza navigate cuando los tipos son distintos', () => {
  const point: AgentAction = { kind: 'point', anchor: 'editFieldsAdd', path, moduleId: module.id }
  const tour: AgentAction = { kind: 'start-tour', tourId: 'editar-campos', path, moduleId: module.id }
  const mixed: AgentMessageReference[] = [{ role: 'assistant', text: 'Campos', actions: [point, tour, navigate] }]
  expect(resolveAgentFollowup('señálamelo', mixed)?.action).toEqual(point)
  expect(resolveAgentFollowup('enséñame', mixed)?.action).toEqual(tour)
  expect(resolveAgentFollowup('vamos', mixed)?.action).toEqual(navigate)
 })
 it('sin acciones recientes pregunta y recupera opciones, sin ejecutar las antiguas', () => {
  const result = resolveAgentFollowup('llévame', [...messages, { role: 'assistant', text: 'Una cortesía sin acciones' }])!
  expect(result.action).toBeUndefined()
  expect(result.reply.reply).toContain('Cuál')
  expect(result.reply.actions[0]).toEqual(navigate)
  const empty = resolveAgentFollowup('llévame', [], [{ kind: 'navigate', path: '/' }])!
  expect(empty.reply.reply).toBe('¿A dónde quieres que te lleve?')
  expect(empty.reply.actions).toEqual([{ kind: 'navigate', path: '/' }])
 })
 it('varios destinos del mismo tipo son ambiguos, máximo tres opciones', () => {
  const actions: AgentAction[] = ['/', '/roles', '/modulos', '/chat'].map(path => ({ kind: 'navigate', path }))
  const result = resolveAgentFollowup('dale', [{ role: 'assistant', text: 'Elige', actions }])!
  expect(result.action).toBeUndefined()
  expect(result.reply.actions).toHaveLength(3)
 })
 it('consume también action singular de ayuda contextual', () => {
  const result = resolveAgentFollowup('enséñame', [{ role: 'assistant', text: 'Campos', action: { kind: 'start-tour', tourId: 'editar-campos' } }])!
  expect(result.action).toEqual({ kind: 'start-tour', tourId: 'editar-campos' })
 })
 it('panel ejecuta la resolución antes de fetch y conserva el estado de las acciones', () => {
  const panel = fs.readFileSync(new URL('../../components/ChattitoPanel.vue', import.meta.url), 'utf8')
  expect(panel).toContain('followup?.reply || courtesyReply(text, history) || await $fetch')
  expect(panel).toContain('if (followup?.action) await runAction(followup.action)')
 })
})
describe('ERD-145 destinos autorizados y proveedor simulado', () => {
 const input = { message: '¿Puedo configurar cupos para una promoción de Servicios?', context }
 const raw = (actions: AgentAction[]) => JSON.stringify({ intent: 'guide', reply: messages[2]!.text, emotion: 'happy', actions })
 it.each(['editTabFields', 'editFieldsAdd', 'editFieldsRows', 'editFieldsPreview'])('otra pantalla: %s se convierte a Campos y ofrece recorrido', anchor => {
  const reply = parseAgentOutput(raw([{ kind: 'point', anchor }]), access, input, travelCatalog)
  expect(reply.reply).toBe(messages[2]!.text)
  expect(reply.actions).toEqual([navigate, { kind: 'start-tour', tourId: 'editar-campos', path, moduleId: module.id }])
 })
 it('sin permisos descarta la acción y explica la administración', () => {
  const reply = parseAgentOutput(raw([{ kind: 'point', anchor: 'editFieldsAdd' }]), { isAdmin: false, designerAvailable: false }, input, travelCatalog)
  expect(reply.actions).toEqual([])
  expect(reply.reply).toContain('administrador')
 })
 it('ancla de la pantalla/pestaña actual se mantiene', () => {
  const current = { ...input, context: { page: 'module-edit', path: `/modulos/${module.id}/editar`, tab: 'fields' } }
  expect(validateAgentActions([{ kind: 'point', anchor: 'editFieldsAdd' }], access, travelCatalog, current)).toEqual([{ kind: 'point', anchor: 'editFieldsAdd', path, moduleId: module.id, label: 'Señálame Campos de Servicios' }, { kind: 'start-tour', tourId: 'editar-campos', path, moduleId: module.id }])
  expect(validateAgentActions([{ kind: 'point', anchor: 'settingsPlanLimits' }], access, [], { context: { page: 'settings', path: '/ajustes', section: 'plan' } })[0]?.kind).toBe('point')
 })
 it('anclas inexistentes, otra organización y destinos incoherentes se descartan', () => {
  for (const action of [
   { kind: 'point' as const, anchor: 'inventado' },
   { kind: 'point' as const, anchor: 'editFieldsAdd', moduleId: 'otro-tenant' },
   { kind: 'point' as const, anchor: 'editFieldsAdd', path: '/modulos/otro-tenant/editar?tab=fields' },
   { kind: 'point' as const, anchor: 'editFieldsAdd', path: `/modulos/${module.id}/editar?tab=api` },
   { kind: 'navigate' as const, path: '/modulos/otro-tenant/editar?tab=fields' }
  ]) expect(validateAgentActions([action], access, travelCatalog, input)).toEqual([])
 })
 it('sin módulo concreto no ofrece un point ni un recorrido inalcanzables', () => {
  expect(validateAgentActions([{ kind: 'point', anchor: 'editFieldsAdd' }, { kind: 'start-tour', tourId: 'editar-campos' }], access, travelCatalog, { message: 'configura campos', context })).toEqual([])
 })
 it('pantalla fija de otra página se convierte a navegación y no duplica destinos', () => {
  expect(validateAgentActions([{ kind: 'navigate', path: '/ajustes?section=plan' }, { kind: 'point', anchor: 'settingsPlanLimits' }], access, [], { context })).toEqual([{ kind: 'navigate', path: '/ajustes?section=plan' }])
 })
 it('historial resume solo acciones recientes; valida límites y excluye rutas/IDs', () => {
  const history = agentHistory(messages)
  expect(history[0]!.actions).toBeUndefined()
  expect(history[2]!.actions).toEqual([{ kind: 'navigate', label: 'Llévame a Campos de Servicios' }])
  const input = { message: 'llévame al lugar donde configuro eso', context, history }
  expect(agentBody.safeParse(input).success).toBe(true)
  for (const actions of [[{ kind: 'navigate', label: 'x'.repeat(66) }], [{ kind: 'inventado', label: 'x' }], Array.from({ length: 4 }, () => ({ kind: 'point', label: 'x' })), [{ kind: 'navigate', label: 'x', path: '/roles' }]]) {
   expect(agentBody.safeParse({ ...input, history: [{ role: 'assistant', text: 'x', actions }] }).success).toBe(false)
  }
  const prompt = agentPrompt(input, access, travelCatalog)
  expect(JSON.parse(prompt.prompt).untrusted_user_data.history[2].actions).toEqual(history[2]!.actions)
  expect(prompt.system).toContain('contexto de referencia')
  expect(cheapAgentReply(input, access, travelCatalog)?.actions[0]).toEqual(navigate)
 })
 it('el resumen reciente impide usar el módulo anterior', () => {
  const history = agentHistory([...messages, { role: 'assistant', text: 'Plan', actions: [{ kind: 'navigate', path: '/ajustes?section=plan', label: 'Llévame a Plan y consumo' }] }])
  const reply = cheapAgentReply({ message: 'llévame al lugar donde configuro eso', context, history }, access, travelCatalog)!
  expect(reply.actions[0]).toEqual({ kind: 'navigate', path: '/ajustes?section=plan' })
  const lastWithoutActions = [...history, { role: 'assistant' as const, text: 'Una cortesía' }]
  expect(cheapAgentReply({ message: 'llévame a eso', context, history: lastWithoutActions }, access, travelCatalog)?.actions).toEqual([])
 })
})

it('ERD-145 validar salida IA con eso toma solo el resumen reciente', () => {
 const history = agentHistory(messages)
 const input = { message: '¿Puedes explicar cómo configuro eso?', history, context }
 const raw = JSON.stringify({ intent: 'guide', reply: 'Campos permite definir ese dato.', emotion: 'happy', actions: [{ kind: 'point', anchor: 'editFieldsAdd' }] })
 expect(parseAgentOutput(raw, access, input, travelCatalog).actions[0]).toEqual(navigate)
})
it('ERD-145 resumen de Nuevo registro conserva módulo y la alta', () => {
 const history = agentHistory([{ role: 'assistant', text: 'Crear servicio', actions: [{ kind: 'navigate', path: '/registros/servicios/nuevo', label: 'Nuevo registro' }] }])
 expect(history[0]!.actions).toEqual([{ kind: 'navigate', label: 'Nuevo registro en servicios' }])
 expect(cheapAgentReply({ message: 'llévame ahí por favor', context, history }, access, travelCatalog)?.actions[0]).toEqual({ kind: 'navigate', path: '/registros/servicios/nuevo', label: 'Nuevo registro' })
})

it('ERD-145 llévame usa la ruta resuelta de un point si no había navigate', () => {
 const result = resolveAgentFollowup('llévame', [{ role: 'assistant', text: 'Campos', actions: [{ kind: 'point', anchor: 'editFieldsAdd', path, moduleId: module.id }] }])!
 expect(result.action).toEqual({ kind: 'navigate', path, moduleId: module.id })
})

it('ERD-145 anclas internas respetan también los permisos propios del paso', () => {
 expect(validateAgentActions([{ kind: 'point', anchor: 'designerAccess' }], { isAdmin: false, designerAvailable: false }, [], { context })).toEqual([])
 expect(validateAgentActions([{ kind: 'point', anchor: 'designerAccess' }], { isAdmin: true, designerAvailable: false }, [], { context })).toEqual([])
})
