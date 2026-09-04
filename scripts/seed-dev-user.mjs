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

// HU multi-organizacion (2026-09-04): tenants.slug es NOT NULL - se
// slugifica orgName (mismo criterio que la migracion 0030's backfill) en vez
// de dejar el default aleatorio de la columna, para que el dato de prueba
// tenga un slug legible.
function slugify(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${base || 'org'}-${tenantId.slice(0, 8)}`
}

try {
  const passwordHash = await bcrypt.hash(password, 12)
  const slug = slugify(orgName)

  // tenants (HU-ERD-61) no tiene RLS - no hace falta set_config para esta fila.
  await sql`
    insert into tenants (id, name, slug)
    values (${tenantId}, ${orgName}, ${slug})
  `

  let personId
  let reusedExistingPerson = false

  await sql.begin(async (tx) => {
    // Mismo mecanismo que withTenant() (server/db/index.ts): setea
    // app.tenant_id para que las politicas RLS (HU-ERD-12) permitan el insert
    // en `users` (la membresia) - `people` no tiene RLS propio (ver el
    // comentario largo en server/db/schema.ts sobre people vs. users), no
    // hace falta para esa fila.
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`

    const [role] = await tx`
      insert into roles (tenant_id, name, is_system)
      values (${tenantId}, 'Administrador', true)
      returning id
    `

    // HU multi-organizacion (2026-09-04): people.email es unico GLOBAL - re-
    // correr este script con el mismo correo ya no puede simplemente volver a
    // insertar en `people` (fallaria con "duplicate key"). Si la persona ya
    // existe (de una corrida anterior, o porque la migracion 0030 la trajo de
    // datos viejos), se reusa su id y solo se agrega la membresia nueva en
    // este tenant - mismo criterio que el camino "existing" de inviteUser()
    // (server/utils/users.ts). Esto es justo lo que faltaba cuando se
    // encontro una persona con 0 membresias: existia en `people` pero nunca
    // habia quedado ligada a ningun tenant.
    const [existingPerson] = await tx`select id from people where email = ${email}`
    if (existingPerson) {
      personId = existingPerson.id
      reusedExistingPerson = true
    } else {
      const [person] = await tx`
        insert into people (email, password_hash, full_name)
        values (${email}, ${passwordHash}, ${fullName})
        returning id
      `
      personId = person.id
    }

    await tx`
      insert into users (tenant_id, person_id, role_id, is_active)
      values (${tenantId}, ${personId}, ${role.id}, true)
    `
  })

  console.log('Usuario de prueba creado.')
  console.log('')
  console.log('  Organizacion:             ', orgName)
  console.log('  Organizacion (tenantId): ', tenantId)
  console.log('  Correo:                  ', email)
  if (reusedExistingPerson) {
    console.log('  (la persona ya existia - se reutilizo, la contrasena NO cambio)')
  } else {
    console.log('  Contrasena:               ', password)
  }
  console.log('')
  console.log('El login (HU multi-organizacion) ya no pide organizacion - solo correo y contrasena.')
} finally {
  await sql.end()
}
