import { chooseAgentVariant, normalizeAgentMessage, type AgentAction, type AgentReply, type AgentReplyContext } from './agentConversation'
import { chattitoCatalog, screenActions, validateAgentActions } from './chattitoCatalog'
import type { TourAccess } from './onboardingTours'
import { agentModulePath, isAgentRouteSlug } from './agentRouteSlug'

export interface AgentTenantModule {
 id: string; slug: string; name: string; singularName: string; description: string
 moduleKind: string; fieldLabels: string[]; canCreate: boolean
}
export type AgentTenantCatalog = AgentTenantModule[] & { totalsByKind?: Record<string, number> }
export function sanitizeCatalogText(value: string | null | undefined, max: number) {
 return (value || '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}
const stopWords = new Set('a al algo ahi como con de del donde el en esa ese eso esta este hay la las lo los me mi mis para por que se su sus tengo tu un una unos unas y ya lista registro registrar registros veo ver capturo capturar agrego agregar consulto consultar anoto anotar llevo llevar hago hacer quiero necesito puedo puedes abre abrir llevame modulo modulos catalogo catalogos'.split(' '))
export function tenantModuleNoun(module: AgentTenantModule) { return module.moduleKind === 'dimension' ? 'catálogo' : 'módulo' }
// Solo corrige erratas conocidas de los dos términos, no nombres arbitrarios del tenant.
function editDistance(left: string, right: string) {
 const rows = Array.from({ length: left.length + 1 }, (_, i) => Array.from({ length: right.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0))
 for (let i = 1; i <= left.length; i++) for (let j = 1; j <= right.length; j++) {
  rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1))
  if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) rows[i]![j] = Math.min(rows[i]![j]!, rows[i - 2]![j - 2]! + 1)
 }
 return rows[left.length]![right.length]!
}
export function normalizeTenantQuestion(message: string) {
 const known = new Set(['catalagos', 'actalagos', 'catlogos', 'catalgo', 'modluos', 'modlos'])
 return normalizeAgentMessage(message).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).map(word => {
  if (!known.has(word)) return word
  return ['catalogos', 'modulos'].find(target => editDistance(word, target) <= 2) || word
 }).join(' ').trim()
}
function requestedKinds(text: string) {
 return [...(/\b(modulos?|hechos?)\b/.test(text) ? ['hecho'] : []), ...(/\b(catalogos?|dimension(?:es)?|(?:tablas|listas) de referencia)\b/.test(text) ? ['dimension'] : [])]
}
function namesList(names: string[]) { return names.length < 2 ? names[0] || '' : `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` }
function directoryAction(kind: string): AgentAction {
 return { kind: 'navigate', path: kind === 'dimension' ? '/catalogos' : '/modulos', label: kind === 'dimension' ? 'Llévame a Catálogos' : 'Llévame a Módulos' }
}
function createAction(kind: string): AgentAction {
 return { kind: 'navigate', path: kind === 'dimension' ? '/catalogos/nuevo' : '/modulos/nuevo', label: kind === 'dimension' ? 'Crear catálogo' : 'Crear módulo' }
}
/** Enumeración y órdenes de abrir pantallas por tipo, antes del catálogo fijo. */
export function tenantOverviewReply(input: AgentReplyContext & { message: string }, access: TourAccess, modules: readonly AgentTenantModule[]): AgentReply | null {
 const text = normalizeTenantQuestion(input.message)
 const kinds = requestedKinds(text)
 if (!kinds.length) return null
 if (/^que (es|son)\b/.test(text)) return null
 // Solo una petición genérica: «abre el catálogo de Servicios» se empareja por nombre.
 const generic = /^(?:(?:no los veo|no las veo) )?(?:(?:que|cuales|son|mis|mi|los|las|el|la|de|a|y|e|tenemos|tengo|hay|estan|disponibles|lista|listame|muestrame|dime|llevame|llevarme|abre|abrir|quiero|ver|veo|modulos?|catalogos?|hechos?|dimensiones?|tablas|listas|referencia)\s*)+$/.test(text)
 if (!generic || /\bcomo\b/.test(text)) return null
 const navigate = /\b(llevame|llevarme|abre|abrir|quiero ver)\b/.test(text)
 const enumeration = /\b(que|cuales|tenemos|tengo|hay|estan|disponibles|lista|listame|muestrame|dime|mis)\b/.test(text) || /^(y |e )?(modulos|catalogos|dimensiones)$/.test(text)
 if (!navigate && !enumeration) return null
 const available = modules.filter(module => isAgentRouteSlug(module.slug) && kinds.includes(module.moduleKind))
 const totals = (modules as AgentTenantCatalog).totalsByKind
 if (navigate && access.isAdmin) return { reply: chooseAgentVariant(['Claro, te llevo a la pantalla de administración que buscas.', 'Vamos a esa pantalla; te acompaño desde ahí.'], input), emotion: 'happy', layer: 'catalog', actions: kinds.map(directoryAction).slice(0, 3) }
 if (navigate) return { reply: chooseAgentVariant(available.length ? ['Esa pantalla es de administración, pero sí puedes abrir estos registros directamente. Elige y te acompaño.', 'Tu administrador gestiona esa pantalla. Te dejo acceso directo a los que puedes consultar.'] : ['Esa pantalla es de administración. Puedes pedirle a tu administrador que te habilite los accesos que necesitas; aquí sigo contigo.', 'Tu administrador puede ayudarte con esa pantalla. Por ahora no veo módulos o catálogos de ese tipo a los que tengas acceso.'], input), emotion: 'happy', layer: 'catalog', actions: available.slice(0, 3).map(module => moduleAction(module, true)) }
 let budget = 12
 const sections = kinds.map((kind, index) => {
  const entries = available.filter(module => module.moduleKind === kind)
  const total = totals?.[kind] ?? entries.length
  const noun = kind === 'dimension' ? 'catálogos' : 'módulos'
  const reserved = kinds.slice(index + 1).reduce((count, nextKind) => count + Math.min(6, available.filter(module => module.moduleKind === nextKind).length), 0)
  const shown = entries.slice(0, Math.max(0, budget - reserved))
  budget -= shown.length
  const countNoun = total === 1 ? kind === 'dimension' ? 'catálogo' : 'módulo' : noun
  return total ? `${total} ${countNoun}: ${namesList(shown.map(module => sanitizeCatalogText(module.name, 32)))}${total > shown.length ? `${shown.length ? ', y ' : ''}${total - shown.length} más disponibles` : ''}` : `todavía no tienes ${noun} disponibles`
 })
 const actions: AgentAction[] = access.isAdmin ? kinds.map(kind => (totals?.[kind] ?? available.filter(module => module.moduleKind === kind).length) > 0 ? directoryAction(kind) : createAction(kind)) : []
 if (available.length > 0 && available.length <= 3) actions.push(...available.map(module => moduleAction(module)))
 const list = sections.join('; ')
 const empty = kinds.every(kind => (totals?.[kind] ?? available.filter(module => module.moduleKind === kind).length) === 0)
 const tail = empty ? access.isAdmin ? ' Si quieres, creamos uno juntos.' : ' Puedes pedirle a tu administrador que los habilite.' : ''
 return { reply: chooseAgentVariant([`Claro, ${list}.`, `Te cuento: ${list}.`, `Estos son los que puedes abrir: ${list}.`], input) + tail, emotion: 'happy', layer: 'catalog', actions: actions.slice(0, 3) }
}
function tokens(text: string) {
 return normalizeAgentMessage(text).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(word => word.length > 2 && !stopWords.has(word)).map(word => word.endsWith('ces') ? word.slice(0, -3) + 'z' : word === 'ordenes' || word.endsWith('iones') ? word.slice(0, -2) : /[aeiou]s$/.test(word) ? word.slice(0, -1) : word.endsWith('es') ? word.slice(0, -2) : word)
}
export function matchTenantModules(message: string, modules: readonly AgentTenantModule[]) {
 const text = normalizeTenantQuestion(message)
 const kinds = requestedKinds(text)
 // «para/de mis clientes» aporta contexto, no el objeto principal que se registra.
 const primary = text.split(/\b(?:para|de) (?:mis|los|las|sus|mi)\b/)[0] || text
 const primaryTokens = tokens(primary)
 const query = new Set(primaryTokens.length ? primaryTokens : tokens(text))
 const ranked = modules.filter(module => isAgentRouteSlug(module.slug) && (kinds.length !== 1 || module.moduleKind === kinds[0])).map(module => {
  const names = new Set(tokens(`${module.name} ${module.singularName} ${module.slug}`))
  const description = new Set(tokens(module.description))
  const fields = new Set(tokens(module.fieldLabels.join(' ')))
  let score = 0; let nameHits = 0
  for (const word of query) { if (names.has(word)) { score += 8; nameHits++ } else if (description.has(word)) score += 2; else if (fields.has(word)) score += 1 }
  return { module, score, nameHits }
 }).filter(hit => hit.nameHits > 0 || hit.score >= 4).sort((a, b) => b.score - a.score || a.module.slug.localeCompare(b.module.slug))
 if (!ranked.length) return []
 return ranked.filter(hit => hit.score >= ranked[0]!.score * 0.75).slice(0, 3).map(hit => hit.module)
}
function moduleAction(module: AgentTenantModule, typed = false): AgentAction {
 return { kind: 'navigate', path: agentModulePath(module.slug), label: (typed ? `Llévame al ${tenantModuleNoun(module)} ${module.name}` : `Llévame a ${module.name}`).slice(0, 65) }
}
export function tenantCatalogReply(input: AgentReplyContext & { message: string }, access: TourAccess, modules: readonly AgentTenantModule[]): AgentReply | null {
 const text = normalizeTenantQuestion(input.message)
 const kinds = requestedKinds(text)
 const intent = /\b(registr(?:o|ar)|veo|ver|captur(?:o|ar)|agreg(?:o|ar)|consult(?:o|ar)|anot(?:o|ar)|llev(?:o|ar)|llevame|abre|abrir|mis|lista de)\b/.test(text)
 // Un nombre completo también puede ser una respuesta breve a «¿cuál quieres abrir?».
 if (!intent && (!text || !modules.some(module => isAgentRouteSlug(module.slug) && [module.name, module.singularName, module.slug].some(name => normalizeTenantQuestion(name) === text)))) return null
 const matches = matchTenantModules(input.message, modules)
 if (matches.length === 1) {
  const module = matches[0]!
  const reply = chooseAgentVariant([
   `Ya tienes el ${tenantModuleNoun(module)} «${module.name}». Ahí puedes ver${module.canCreate ? ' y registrar' : ''} tus ${module.name.toLowerCase()}.`,
   `Lo encuentras en el ${tenantModuleNoun(module)} «${module.name}». Te llevo ahí para consultar${module.canCreate ? ' o agregar registros' : ' tus registros'}.`,
   `Claro, ya cuentas con el ${tenantModuleNoun(module)} «${module.name}». Vamos ahí para ver${module.canCreate ? ' o registrar' : ''} lo que necesitas.`
  ], input)
  return { reply, emotion: 'happy', layer: 'catalog', actions: [moduleAction(module), ...(module.canCreate ? [{ kind: 'navigate' as const, path: agentModulePath(module.slug, true), label: 'Nuevo registro' }] : [])] }
 }
 if (matches.length > 1) return { reply: chooseAgentVariant([`Veo varias opciones: ${matches.map(module => `${tenantModuleNoun(module)} «${module.name}»`).join(', ')}. ¿Cuál quieres abrir?`, `Podría ser ${matches.map(module => `${tenantModuleNoun(module)} «${module.name}»`).join(' o ')}. Elige y te acompaño.`], input), emotion: 'happy', layer: 'catalog', actions: matches.map(module => moduleAction(module, true)) }
 if (kinds.length === 1 && kinds[0] === 'dimension') return { reply: chooseAgentVariant(access.isAdmin ? ['No veo un catálogo para eso todavía. ¿Quieres crear uno? Te acompaño.', 'Todavía no encuentro ese catálogo. Podemos crear uno juntos.'] : ['No veo un catálogo disponible para eso. Tu administrador puede ayudarte a habilitarlo.', 'Todavía no encuentro ese catálogo entre tus accesos. Pide ayuda a tu administrador; aquí sigo contigo.'], input), emotion: 'happy', layer: 'catalog', actions: access.isAdmin ? [createAction('dimension')] : [] }
 // Consultas de pantallas fijas siguen resolviéndose en su catálogo.
 if (!/\b(registr(?:o|ar)|captur(?:o|ar)|agreg(?:o|ar)|anot(?:o|ar)|llev(?:o|ar)|lista de)\b/.test(text)) return null
 const create = chattitoCatalog.find(screen => screen.id === 'create')!
 return { reply: chooseAgentVariant(access.isAdmin ? ['No veo un módulo para eso todavía. ¿Quieres crear uno? Te acompaño paso a paso.', 'Todavía no encuentro un módulo para eso. Podemos crear uno juntos con el asistente.'] : ['No veo un módulo disponible para eso. Puedes pedirle a tu administrador que lo habilite; aquí sigo para ayudarte.', 'Todavía no encuentro un módulo al que tengas acceso para eso. Tu administrador puede ayudarte a habilitarlo.'], input) + (access.isAdmin && access.designerAvailable ? ' También puedes usar el Diseñador.' : ''), emotion: 'happy', layer: 'catalog', actions: validateAgentActions(screenActions(create).filter(action => action.kind !== 'point'), access) }
}
/** JSON delimitado como datos, nunca texto interpolado en las instrucciones. */
export function tenantPromptSummary(modules: readonly AgentTenantModule[]) {
 const summary: { name: string; slug: string; description: string; canCreate: boolean; moduleKind: string; type: string }[] = []
 for (const module of modules.slice(0, 60)) {
  if (!isAgentRouteSlug(module.slug)) continue
  const item = { name: sanitizeCatalogText(module.name, 80), slug: module.slug, description: sanitizeCatalogText(module.description, 80), canCreate: module.canCreate, moduleKind: module.moduleKind, type: tenantModuleNoun(module) }
  if (JSON.stringify([...summary, item]).length > 2000) break
  summary.push(item)
 }
 return summary
}
