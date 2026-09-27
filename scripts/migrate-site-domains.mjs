import postgres from 'postgres'

const args = process.argv.slice(2)
const provider = args.find(value => !value.startsWith('--'))
const dryRun = args.includes('--dry-run')
const apply = args.includes('--apply')

if (!['vercel', 'railway'].includes(provider)) {
  console.error('Uso: node scripts/migrate-site-domains.mjs <vercel|railway> --dry-run|--apply')
  process.exit(2)
}
if (dryRun === apply) {
  console.error('Indica exactamente una opción: --dry-run o --apply')
  process.exit(2)
}

const databaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Configura APP_DATABASE_URL o DATABASE_URL para leer los dominios publicados')

const sql = postgres(databaseUrl, { max: 1, prepare: false })
try {
  const domains = await sql`select id, hostname, provider_data from site_domains where status = 'active' order by hostname`
  if (domains.length !== 2) console.warn(`Aviso: se encontraron ${domains.length} dominios activos; la HU espera 2 dominios publicados.`)
  const results = []
  for (const { id, hostname } of domains) {
    if (dryRun) {
      results.push({ hostname, destination: provider, action: 'register', dnsChanges: 'Se obtendrán del proveedor al registrar; no se llamó a ninguna API.' })
      continue
    }
    if (provider === 'railway') {
      const token = process.env.RAILWAY_API_TOKEN
      const projectId = process.env.RAILWAY_PROJECT_ID
      const serviceId = process.env.RAILWAY_SERVICE_ID
      const environmentId = process.env.RAILWAY_ENVIRONMENT_ID
      if (!token || !projectId || !serviceId || !environmentId) throw new Error('Railway requiere RAILWAY_API_TOKEN, RAILWAY_PROJECT_ID, RAILWAY_SERVICE_ID y RAILWAY_ENVIRONMENT_ID')
      const response = await fetch('https://backboard.railway.com/graphql/v2', {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'mutation customDomainCreate($input: CustomDomainCreateInput!) { customDomainCreate(input: $input) { domain id status { dnsRecords { recordType fqdn requiredValue purpose status } verificationDnsHost verificationToken } } }', variables: { input: { projectId, serviceId, environmentId, domain: hostname } } })
      })
      const body = await response.json()
      if (!response.ok || body.errors?.length) throw new Error(body.errors?.map(error => error.message).join('; ') || `Railway respondió ${response.status}`)
      const registration = body.data.customDomainCreate
      const dnsRecords = registration.status?.dnsRecords || []
      await sql`update site_domains set provider = 'railway', provider_data = coalesce(provider_data, '{}'::jsonb) || ${JSON.stringify({ railwayConfigured: true, railway: registration, dnsRecords })}::jsonb, updated_at = now() where id = ${id}`
      results.push({ hostname, destination: provider, registration })
    } else {
      const token = process.env.VERCEL_TOKEN
      const projectId = process.env.VERCEL_PROJECT_ID
      if (!token || !projectId) throw new Error('Vercel requiere VERCEL_TOKEN y VERCEL_PROJECT_ID')
      const url = new URL(`https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/domains`)
      if (process.env.VERCEL_TEAM_ID) url.searchParams.set('teamId', process.env.VERCEL_TEAM_ID)
      const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: hostname }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error?.message || `Vercel respondió ${response.status}`)
      await sql`update site_domains set provider = 'vercel', provider_data = coalesce(provider_data, '{}'::jsonb) || ${JSON.stringify({ vercelConfigured: true, vercel: body })}::jsonb, updated_at = now() where id = ${id}`
      results.push({ hostname, destination: provider, registration: body, dnsChanges: 'Consulta los registros de verificación y enrutamiento devueltos por Vercel.' })
    }
  }
  console.log(JSON.stringify({ mode: dryRun ? 'dry-run' : 'apply', provider, domains: results }, null, 2))
} finally {
  await sql.end()
}
