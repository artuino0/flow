/** Navegación a entidades existentes, distinta de la regla de creación SLUG_PATTERN.
 * Solo segmentos ASCII sin caracteres de URL; máximo 100 caracteres. */
export const AGENT_ROUTE_SLUG_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/
export function isAgentRouteSlug(slug: string) {
 return slug.length <= 100 && AGENT_ROUTE_SLUG_PATTERN.exec(slug)?.[0] === slug
}
// El final absoluto rechaza incluso el salto de línea final que JavaScript permite con $.
export const AGENT_MODULE_PATH = new RegExp(`^/registros/((?=[^/]{1,100}(?:/nuevo)?$)${AGENT_ROUTE_SLUG_PATTERN.source.slice(1, -1)})(/nuevo)?$(?![\\s\\S])`)
export function agentModulePath(slug: string, create = false) {
 if (!isAgentRouteSlug(slug)) throw new Error('Invalid agent route slug')
 return `/registros/${encodeURIComponent(slug)}${create ? '/nuevo' : ''}`
}
