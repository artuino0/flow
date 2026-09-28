/** Cuentas de QA para todas las organizaciones de la base local. */
import { readFileSync } from 'node:fs'
import { parse } from 'dotenv'
import postgres from 'postgres'
import bcrypt from 'bcryptjs'

const config = parse(readFileSync(new URL('../.env', import.meta.url)))
const connectionString = config.DATABASE_URL
if (!connectionString) throw new Error('Falta DATABASE_URL en frontback/.env')

let databaseUrl
try { databaseUrl = new URL(connectionString) }
catch { throw new Error('DATABASE_URL de frontback/.env no es una URL válida') }
if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)
  || !['localhost', '127.0.0.1'].includes(databaseUrl.hostname)
  || databaseUrl.port !== '5433') {
  throw new Error('Seed cancelado: DATABASE_URL debe ser PostgreSQL local en localhost o 127.0.0.1, puerto 5433')
}

const password = config.QA_PASSWORD
if (!password || password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
  throw new Error('QA_PASSWORD de frontback/.env debe tener al menos 8 caracteres, una letra y un número')
}

function slugifyRole(name, id) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `rol-${id.slice(0, 8)}`
}

const db = postgres(connectionString, { max: 1, prepare: false })
try {
  const passwordHash = await bcrypt.hash(password, 12)
  const report = await db.begin(async tx => {
    await tx`select pg_advisory_xact_lock(115, 2026)`
    const tenants = await tx`select id, name, slug from tenants order by name, id`
    const rows = []
    for (const tenant of tenants) {
      await tx`select set_config('app.tenant_id', ${tenant.id}, true)`
      await tx`update tenants set onboarding_status = 'complete', updated_at = now()
        where id = ${tenant.id} and onboarding_status <> 'complete'`
      const roles = await tx`select id, name, is_system from roles where tenant_id = ${tenant.id} order by name, id`
      if (!roles.length) throw new Error(`La organización ${tenant.slug} no tiene roles; seed cancelado`)
      const slugs = roles.map(role => slugifyRole(role.name, role.id))
      const duplicates = new Set(slugs.filter((slug, index) => slugs.indexOf(slug) !== index))
      const [subscription] = await tx`select p.name from tenant_subscriptions s
        join plans p on p.id = s.plan_id where s.tenant_id = ${tenant.id}`
      const modules = await tx`select name from entities where tenant_id = ${tenant.id}
        and module_kind = 'hecho' and is_active and deleted_at is null order by name limit 12`
      for (const [index, role] of roles.entries()) {
        const roleSlug = duplicates.has(slugs[index]) ? `${slugs[index]}-${role.id.slice(0, 8)}` : slugs[index]
        const email = `qa-${roleSlug}@${tenant.slug}.local`.toLowerCase()
        const [person] = await tx`insert into people (email, password_hash, full_name, email_verified_at, totp_enabled, totp_secret)
          values (${email}, ${passwordHash}, ${`QA ${role.name} · ${tenant.name}`}, now(), false, null)
          on conflict (email) do update set password_hash = excluded.password_hash,
            email_verified_at = now(), totp_enabled = false, totp_secret = null, updated_at = now()
          returning id`
        await tx`insert into users (tenant_id, person_id, role_id, is_active)
          values (${tenant.id}, ${person.id}, ${role.id}, true)
          on conflict (tenant_id, person_id) do update set role_id = excluded.role_id,
            is_active = true, invitation_token_hash = null, invitation_expires_at = null, updated_at = now()`
        const permissions = role.is_system ? [] : await tx`select p.visibility from role_entity_permissions p
          join entities e on e.id = p.entity_id
          where p.role_id = ${role.id} and e.tenant_id = ${tenant.id}
            and e.deleted_at is null and p.can_read`
        const visibility = role.is_system ? 'Todos (sistema)'
          : permissions.length === 0 ? 'Sin lectura asignada'
            : permissions.every(permission => permission.visibility === 'all') ? 'Todos'
              : permissions.every(permission => permission.visibility === 'own') ? 'Solo los suyos' : 'Mixta'
        rows.push({ organization: tenant.name, slug: tenant.slug, role: role.name, email,
          visibility, plan: subscription?.name ?? 'Sin suscripción (Starter predeterminado)',
          modules: modules.map(module => module.name) })
      }
    }
    return rows
  })
  if (process.argv.includes('--report-json')) console.log(JSON.stringify(report, null, 2))
  else console.log(`Usuarios QA preparados: ${report.length} en ${new Set(report.map(row => row.slug)).size} organizaciones.`)
} finally {
  await db.end()
}
