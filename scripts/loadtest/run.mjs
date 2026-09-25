/**
 * Prueba de carga HTTP contra una instancia de Flow apuntando a la base `erp_load`
 * (ver setup.mjs). Usuarios virtuales en lazo cerrado: cada uno elige una
 * organización, manda una petición, espera la respuesta y sigue. Se mide por nivel
 * de concurrencia: peticiones por segundo, latencias p50/p95/p99 y errores, más las
 * conexiones abiertas a Postgres.
 *
 * Uso:
 *   node --env-file=.env scripts/loadtest/run.mjs --url http://localhost:4000 --levels 10,50,100,200 --duration 20
 * Requiere JWT_SECRET (el mismo de la instancia) y DATABASE_URL (rol admin, local).
 */
import postgres from 'postgres'
import jwt from 'jsonwebtoken'
import fs from 'node:fs'

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, item, i, all) => item.startsWith('--') ? [...acc, [item.slice(2), all[i + 1]]] : acc, []))
// --url acepta varias instancias separadas por coma (se reparte al azar entre ellas).
const BASES = (args.url || 'http://localhost:4000').split(',')
const BASE_LABEL = BASES.join(', ')
const LEVELS = (args.levels || '10,50,100,200').split(',').map(Number)
const DURATION_MS = Number(args.duration || 20) * 1000
const SAMPLE_TENANTS = Number(args.tenants || 300)
const WRITE_SHARE = Number(args.writes ?? 0.1)
const OUT = args.out || null
const SLUGS = ['clientes', 'productos', 'pedidos', 'facturas', 'tareas', 'contactos']

const admin = new URL(process.env.DATABASE_URL); admin.pathname = '/erp_load'
const sql = postgres(admin.toString(), { max: 2, onnotice: () => {} })

// Organizaciones de prueba: las 10 grandes siempre (reciben ~25% del tráfico) + una muestra de chicas.
const rows = await sql`
  select t.id as tenant_id, u.id as user_id, u.role_id, s.id as sid, split_part(t.slug, '-', 2)::int as n
  from tenants t join users u on u.tenant_id = t.id join auth_sessions s on s.user_id = u.id
  where split_part(t.slug, '-', 2)::int <= ${SAMPLE_TENANTS} order by n`
// Las sesiones sintéticas caducan por inactividad (30 min): se renuevan al empezar.
await sql`update auth_sessions set last_seen_at = now(), expires_at = now() + interval '30 days'`
const secret = process.env.JWT_SECRET
if (!secret) throw new Error('Falta JWT_SECRET')
const accounts = rows.map(row => ({
  n: row.n, big: row.n <= 10, tenantId: row.tenant_id, ids: {},
  token: jwt.sign({ sub: row.user_id, tenantId: row.tenant_id, roleId: row.role_id, sid: row.sid }, secret, { expiresIn: '2h' })
}))
const bigAccounts = accounts.filter(a => a.big)
const smallAccounts = accounts.filter(a => !a.big)
const pick = list => list[Math.floor(Math.random() * list.length)]
const account = () => (Math.random() < 0.25 ? pick(bigAccounts) : pick(smallAccounts))

const percentile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0

async function call(account, kind, slug) {
  const BASE = BASES[Math.floor(Math.random() * BASES.length)]
  const headers = { authorization: `Bearer ${account.token}`, 'content-type': 'application/json' }
  const started = performance.now()
  let status = 0
  try {
    let response
    if (kind === 'list') response = await fetch(`${BASE}/api/records/${slug}?page=${1 + Math.floor(Math.random() * 3)}&pageSize=20`, { headers })
    else if (kind === 'fields') response = await fetch(`${BASE}/api/entities/${slug}/fields`, { headers })
    else if (kind === 'search') response = await fetch(`${BASE}/api/records/${slug}?search=${encodeURIComponent('Empresa ' + Math.random().toString(16).slice(2, 4))}&pageSize=20`, { headers })
    else if (kind === 'get') {
      const id = account.ids[slug]
      if (!id) { const list = await fetch(`${BASE}/api/records/${slug}?pageSize=1`, { headers }); const body = await list.json().catch(() => null); account.ids[slug] = body?.data?.[0]?.id; return null }
      response = await fetch(`${BASE}/api/records/${slug}/${id}`, { headers })
    } else {
      response = await fetch(`${BASE}/api/records/${slug}`, { method: 'POST', headers, body: JSON.stringify({ customData: { nombre: 'Carga ' + Math.random().toString(16).slice(2, 10), correo: 'x@carga.test', estado: 'activo', monto: '10.50', fecha: '2026-09-01', notas: 'prueba de carga' } }) })
    }
    status = response.status
    await response.arrayBuffer()
  } catch { status = -1 }
  return { kind, ms: performance.now() - started, status }
}

function chooseKind() {
  const r = Math.random()
  if (r < WRITE_SHARE) return 'create'
  const read = (r - WRITE_SHARE) / (1 - WRITE_SHARE)
  if (read < 0.62) return 'list'
  if (read < 0.80) return 'fields'
  if (read < 0.92) return 'get'
  return 'search'
}

async function level(concurrency) {
  const samples = []
  const stop = performance.now() + DURATION_MS
  let peakConnections = 0
  let peakActive = 0
  const monitor = setInterval(async () => {
    const [row] = await sql`select count(*)::int as total, count(*) filter (where state = 'active')::int as active from pg_stat_activity where datname = 'erp_load'`.catch(() => [{ total: 0, active: 0 }])
    peakConnections = Math.max(peakConnections, row.total); peakActive = Math.max(peakActive, row.active)
  }, 500)
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (performance.now() < stop) {
      const result = await call(account(), chooseKind(), pick(SLUGS))
      if (result) samples.push(result)
    }
  }))
  clearInterval(monitor)
  const ok = samples.filter(s => s.status >= 200 && s.status < 300)
  const errors = samples.filter(s => !(s.status >= 200 && s.status < 300))
  const byStatus = errors.reduce((acc, s) => ({ ...acc, [s.status]: (acc[s.status] || 0) + 1 }), {})
  const latencies = ok.map(s => s.ms).sort((a, b) => a - b)
  const perKind = Object.fromEntries(['list', 'fields', 'get', 'search', 'create'].map(kind => {
    const l = ok.filter(s => s.kind === kind).map(s => s.ms).sort((a, b) => a - b)
    return [kind, { n: l.length, p50: Math.round(percentile(l, 0.5)), p95: Math.round(percentile(l, 0.95)) }]
  }))
  return {
    concurrency, rps: Math.round(samples.length / (DURATION_MS / 1000)), okRps: Math.round(ok.length / (DURATION_MS / 1000)),
    p50: Math.round(percentile(latencies, 0.5)), p95: Math.round(percentile(latencies, 0.95)), p99: Math.round(percentile(latencies, 0.99)),
    errors: errors.length, errorRate: samples.length ? +(errors.length / samples.length * 100).toFixed(2) : 0, byStatus,
    pgConnectionsPeak: peakConnections, pgActivePeak: peakActive, perKind
  }
}

console.log(`Objetivo ${BASE_LABEL} · ${accounts.length} organizaciones de muestra (${bigAccounts.length} grandes) · ${DURATION_MS / 1000}s por nivel · ${Math.round(WRITE_SHARE * 100)}% escrituras`)
// Calentamiento breve (JIT, caches, pool).
await Promise.all(Array.from({ length: 8 }, async () => { for (let i = 0; i < 15; i++) await call(account(), chooseKind(), pick(SLUGS)) }))
const results = []
for (const concurrency of LEVELS) {
  const result = await level(concurrency)
  results.push(result)
  console.log(`c=${String(concurrency).padEnd(4)} rps=${String(result.rps).padEnd(5)} p50=${String(result.p50).padEnd(5)}ms p95=${String(result.p95).padEnd(5)}ms p99=${String(result.p99).padEnd(5)}ms errores=${result.errors} (${result.errorRate}%) ${JSON.stringify(result.byStatus)} pgConn=${result.pgConnectionsPeak} pgActivo=${result.pgActivePeak}`)
  console.log('        ' + Object.entries(result.perKind).map(([k, v]) => `${k}: p50 ${v.p50} / p95 ${v.p95} (n=${v.n})`).join(' · '))
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2))
await sql.end()
