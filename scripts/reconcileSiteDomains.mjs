import { pathToFileURL } from 'node:url'

const normalize = value => String(value).trim().toLowerCase().replace(/\.$/, '')
const zoneManaged = row => row.providerData?.cloudflare?.managedByZone === true
export function reconciliationReport(local, remote, provider) {
  // Todos los proveedores locales cuentan: una migración nunca vuelve huérfano un nombre en uso.
  const localNames = new Set(local.map(row => normalize(row.hostname)))
  const remoteNames = new Set(remote.map(row => normalize(row.hostname)))
  const duplicates = rows => [...new Set(rows.map(row => normalize(row.hostname)))].filter(name => rows.filter(row => normalize(row.hostname) === name).length > 1)
  return {
    provider,
    localWithoutRemote: local.filter(row => row.provider === provider && !zoneManaged(row) && !remoteNames.has(normalize(row.hostname))).map(row => normalize(row.hostname)),
    remoteWithoutLocal: [...remoteNames].filter(name => !localNames.has(name)),
    duplicateLocal: duplicates(local), duplicateRemote: duplicates(remote)
  }
}
export function reconciliationOptions(args) {
  const apply = args.includes('--apply'), index = args.indexOf('--only')
  const only = index >= 0 ? normalize(args[index + 1] ?? '') : ''
  if (args.some((arg, i) => !['--apply', '--only'].includes(arg) && i !== index + 1) || args.filter(arg => arg === '--only').length > 1) throw new Error('Uso: reconcileSiteDomains.mjs [--apply --only <hostname>]')
  if ((apply || index >= 0) && (!apply || !only || !/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(only))) throw new Error('--apply exige --only <hostname>; solo se confirma un nombre.')
  return { apply, only }
}
function requireEnv(env, keys) {
  if (keys.some(key => !env[key]?.trim())) throw new Error('Falta configuración del proveedor o de la base de conciliación.')
}
function protectedHostnames(env) {
  return [env.APP_BASE_URL, env.RAILWAY_PUBLIC_DOMAIN, env.CLOUDFLARE_FALLBACK_ORIGIN, env.CLOUDFLARE_CNAME_TARGET,
    ...String(env.SITE_DOMAIN_PROTECTED_HOSTNAMES ?? '').split(',')].filter(Boolean).flatMap(value => {
    try { return [normalize(new URL(value.includes('://') ? value : `https://${value}`).hostname)] } catch { return [] }
  })
}
export function remoteAdapter(env, fetcher = fetch) {
  const provider = env.SITE_DOMAIN_PROVIDER?.trim().toLowerCase()
  if (provider === 'cloudflare') {
    requireEnv(env, ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ZONE_ID'])
    const base = `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(env.CLOUDFLARE_ZONE_ID)}/custom_hostnames`
    const call = async (path, method = 'GET') => {
      const response = await fetcher(base + path, { method, headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } })
      if (method === 'DELETE' && response.status === 404) return { success: true }
      const body = await response.json().catch(() => ({}))
      if (!response.ok || body.success !== true) throw new Error('El proveedor rechazó la conciliación; revisa permisos y disponibilidad.')
      return body
    }
    return {
      provider, protectedHostnames: protectedHostnames(env),
      async list() {
        const rows = [], ids = new Set()
        for (let page = 1; page <= 10000; page++) {
          const body = await call(`?page=${page}&per_page=50`)
          if (!Array.isArray(body.result)) throw new Error('Listado remoto incompleto; no se aplicará la conciliación.')
          for (const row of body.result) {
            if (!row?.id || !row.hostname || ids.has(row.id)) throw new Error('Paginación inconsistente; no se aplicará la conciliación.')
            ids.add(row.id); rows.push({ id: row.id, hostname: row.hostname })
          }
          if (body.result_info?.total_pages !== undefined ? page >= body.result_info.total_pages : body.result.length < 50) return rows
        }
        throw new Error('Listado remoto excede el límite; no se aplicará la conciliación.')
      },
      async remove(row) { await call(`/${encodeURIComponent(row.id)}`, 'DELETE') }
    }
  }
  if (provider === 'railway') {
    requireEnv(env, ['RAILWAY_API_TOKEN', 'RAILWAY_SERVICE_ID', 'RAILWAY_ENVIRONMENT_ID'])
    const call = async (query, variables) => {
      const response = await fetcher('https://backboard.railway.com/graphql/v2', { method: 'POST', headers: { authorization: `Bearer ${env.RAILWAY_API_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || body.errors?.length || !body.data) throw new Error('El proveedor rechazó la conciliación; revisa permisos y disponibilidad.')
      return body.data
    }
    return {
      provider, protectedHostnames: protectedHostnames(env),
      async list() {
        const data = await call('query domains($environmentId: String!, $serviceId: String!) { domains(environmentId: $environmentId, serviceId: $serviceId) { customDomains { id domain } } }', { environmentId: env.RAILWAY_ENVIRONMENT_ID, serviceId: env.RAILWAY_SERVICE_ID })
        if (!Array.isArray(data.domains?.customDomains) || data.domains.customDomains.some(row => !row.id || !row.domain)) throw new Error('Listado remoto incompleto; no se aplicará la conciliación.')
        // Los dominios automáticos del servicio no son dominios propios de clientes.
        return data.domains.customDomains.map(row => ({ id: row.id, hostname: row.domain }))
      },
      async remove(row) { await call('mutation customDomainDelete($id: String!) { customDomainDelete(id: $id) }', { id: row.id }) }
    }
  }
  throw new Error('Conciliación disponible para cloudflare y railway.')
}
/** @param {{ args?: string[], readLocal: () => Promise<{hostname: string, provider: string}[]>, remote: {provider: string, protectedHostnames?: string[], list: () => Promise<{id: string, hostname: string}[]>, remove: (row: {id: string, hostname: string}) => Promise<unknown>}, output?: (message: string) => void }} options */
export async function reconcileSiteDomains({ args = [], readLocal, remote, output = console.log }) {
  const { apply, only } = reconciliationOptions(args)
  const local = await readLocal(), rows = await remote.list()
  const report = reconciliationReport(local, rows, remote.provider)
  output(JSON.stringify(report, null, 2))
  if (!apply) return report
  if (remote.protectedHostnames?.includes(only)) throw new Error('El nombre está reservado para la aplicación o infraestructura; no se borró nada.')
  if (!report.remoteWithoutLocal.includes(only) || report.duplicateRemote.includes(only)) throw new Error('El nombre confirmado no es un huérfano remoto único; no se borró nada.')
  // Volver a leer justo antes del borrado para evitar una asociación local recién creada.
  if ((await readLocal()).some(row => normalize(row.hostname) === only)) throw new Error('El dominio ahora tiene una fila local; no se borró nada.')
  const selected = rows.find(row => normalize(row.hostname) === only)
  if (!selected) throw new Error('El nombre confirmado ya no existe en el inventario.')
  await remote.remove(selected)
  output(`Eliminado únicamente el huérfano confirmado: ${only}`)
  return report
}
async function main() {
  reconciliationOptions(process.argv.slice(2))
  const url = process.env.RECONCILE_DATABASE_URL
  if (!url) throw new Error('Configura una conexión administrativa de solo lectura para la conciliación.')
  const remote = remoteAdapter(process.env)
  const { default: postgres } = await import('postgres')
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    await reconcileSiteDomains({ args: process.argv.slice(2), remote, readLocal: () => sql.begin('read only', async tx => {
      // No usar una conexión RLS parcial: impediría ver asociaciones de otros tenants.
      const [role] = await tx`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`
      if (!role?.rolsuper && !role?.rolbypassrls) throw new Error('La conexión no puede inventariar todos los tenants; no se borró nada.')
      return tx`select hostname, provider, provider_data as "providerData" from site_domains order by hostname`
    }) })
  } finally { await sql.end() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('No se completó la conciliación. Comprueba configuración, --apply --only, permisos y listado; no se muestran credenciales.'); process.exitCode = 1 })
}
