// Diagnostico local: revisa por que un correo puede loguear (persona valida)
// pero recibe "Credenciales invalidas" al final del flujo - eso pasa cuando
// resolveLoginResult() (server/utils/peopleAuth.ts) no encuentra ninguna
// membresia ACTIVA para esa persona en ningun tenant. No forma parte del
// build ni de ninguna HU, solo una herramienta de diagnostico.
//
// Uso:
//   node scripts/check-person.mjs admin@acme.com
//
// Requiere que APP_DATABASE_URL (o DATABASE_URL) apunte al mismo Postgres
// que usa la app (por defecto localhost:5433, igual que seed-dev-user.mjs).
// No imprime password_hash ni ningun dato sensible.

import postgres from 'postgres'

const connectionString =
  process.env.APP_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://erp_app:changeme_app@localhost:5433/erp_dinamico'

const email = (process.argv[2] || '').trim().toLowerCase()
if (!email) {
  console.error('Uso: node scripts/check-person.mjs correo@ejemplo.com')
  process.exit(1)
}

const sql = postgres(connectionString)

try {
  const people = await sql`select id, email, full_name, totp_enabled, created_at, updated_at from people where email = ${email}`

  if (people.length === 0) {
    console.log(`No existe ninguna fila en "people" con el correo "${email}".`)
    console.log('Eso significaria que la contraseña NO deberia poder validarse - si el login llego hasta resolveLoginResult(), algo no cuadra con lo que se está probando.')
    process.exit(0)
  }
  if (people.length > 1) {
    console.log(`ALERTA: hay ${people.length} filas en "people" con el mismo correo (deberia ser unico). Esto es un bug real.`)
  }

  for (const person of people) {
    console.log('')
    console.log('=== people ===')
    console.log('  id:          ', person.id)
    console.log('  email:       ', person.email)
    console.log('  full_name:   ', person.full_name)
    console.log('  totp_enabled:', person.totp_enabled)
    console.log('  created_at:  ', person.created_at)
    console.log('  updated_at:  ', person.updated_at)

    // Left join a tenants a proposito (no inner join, como hace
    // listActiveMembershipsForPerson) - asi se ve tambien una membresia
    // "huerfana" cuyo tenant_id ya no existe.
    const memberships = await sql`
      select u.id as user_id, u.tenant_id, t.name as tenant_name, u.role_id, u.is_active,
             u.invitation_token_hash is not null as invitation_pending, u.created_at, u.updated_at
      from users u
      left join tenants t on t.id = u.tenant_id
      where u.person_id = ${person.id}
      order by u.created_at
    `

    console.log(`=== membresias (${memberships.length}) ===`)
    if (memberships.length === 0) {
      console.log('  Ninguna. Esta persona no tiene NINGUNA fila en "users" - por eso resolveLoginResult() no encuentra con que organizacion entrar.')
    }
    for (const m of memberships) {
      const tenantLabel = m.tenant_name ? `"${m.tenant_name}"` : `(tenant_id ${m.tenant_id} no existe en "tenants" - membresia huerfana)`
      console.log(`  - user_id=${m.user_id} tenant=${tenantLabel} is_active=${m.is_active} invitacion_pendiente=${m.invitation_pending} role_id=${m.role_id}`)
    }

    const activeCount = memberships.filter((m) => m.is_active && m.tenant_name).length
    console.log(`=== resultado esperado de resolveLoginResult(): ${activeCount} membresia(s) activa(s) con tenant valido ===`)
    if (activeCount === 0) {
      console.log('  -> Por eso da "Credenciales invalidas": la contraseña es correcta pero no hay ningun tenant donde entrar.')
    } else if (activeCount === 1) {
      console.log('  -> Deberia entrar directo, sin pedir organizacion.')
    } else {
      console.log('  -> Deberia pedir elegir organizacion (select).')
    }
  }
} finally {
  await sql.end()
}
