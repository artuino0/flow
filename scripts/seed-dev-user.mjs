// Script de desarrollo: crea un tenant + rol Administrador + usuario, para
// poder probar el login sin depender de un seed real (no existe todavia).
// No forma parte del build ni de ninguna HU - es solo una herramienta local.
//
// Uso:
//   node scripts/seed-dev-user.mjs [email] [password] [nombre] [organizacion]
//
// Por defecto: admin@acme.com / admin1234 / Admin Acme / Acme S.A. de C.V.
//
// Requiere que APP_DATABASE_URL (o DATABASE_URL) apunte a un Postgres con las
// migraciones ya aplicadas (npm run db:migrate).

import postgres from 'postgres'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'

const connectionString =
  process.env.APP_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://erp_app:changeme_app@localhost:5433/erp_dinamico'

const email = process.argv[2] || 'admin@acme.com'
const password = process.argv[3] || 'admin1234'
const fullName = process.argv[4] || 'Admin Acme'
const orgName = process.argv[5] || 'Acme S.A. de C.V.'

const sql = postgres(connectionString)
const tenantId = randomUUID()

try {
  const passwordHash = await bcrypt.hash(password, 12)

  // tenants (HU-ERD-61) no tiene RLS - no hace falta set_config para esta fila.
  await sql`
    insert into tenants (id, name)
    values (${tenantId}, ${orgName})
  `

  await sql.begin(async (tx) => {
    // Mismo mecanismo que withTenant() (server/db/index.ts): setea
    // app.tenant_id para que las politicas RLS (HU-ERD-12) permitan el insert.
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`

    const [role] = await tx`
      insert into roles (tenant_id, name, is_system)
      values (${tenantId}, 'Administrador', true)
      returning id
    `

    await tx`
      insert into users (tenant_id, role_id, email, password_hash, full_name, is_active)
      values (${tenantId}, ${role.id}, ${email}, ${passwordHash}, ${fullName}, true)
    `
  })

  console.log('Usuario de prueba creado.')
  console.log('')
  console.log('  Organizacion:             ', orgName)
  console.log('  Organizacion (tenantId): ', tenantId)
  console.log('  Correo:                  ', email)
  console.log('  Contrasena:               ', password)
  console.log('')
  console.log('El campo "Organizacion" del login todavia pide este UUID tal cual (no hay slug ni selector automatico aun).')
} finally {
  await sql.end()
}
