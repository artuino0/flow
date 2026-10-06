/** Prefijos propios actuales y los dos formatos históricos inventariados.
 * Nunca se acepta una llave de otra organización, absoluta o con traversal. */
export function accountObjectKey(tenantId: string, table: string, value: string) {
  const normalized = value.replaceAll('\\', '/')
  if (normalized.includes('..') || normalized.startsWith('/')) throw new Error('Archivo fuera del prefijo de propiedad')
  if (normalized.startsWith(`tenants/${tenantId}/`)) return normalized
  if (table === 'tenants' && normalized.startsWith(`${tenantId}/logo-`)) return normalized
  if (table === 'files' && normalized.startsWith(`${tenantId}/`)) return normalized
  if (table === 'chat_attachments' && normalized.startsWith(`${tenantId}/`)) return `chat/${normalized}`
  throw new Error('Archivo fuera del prefijo de propiedad')
}
export function ownAccountObject(tenantId: string, key: string) {
  return !key.includes('..') && !key.includes('\\') && [ `tenants/${tenantId}/`, `${tenantId}/`, `chat/${tenantId}/` ].some(prefix => key.startsWith(prefix))
}
