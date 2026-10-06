import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/server/db'
import { people, roles, tenants, users } from '~/server/db/schema'
import { hashPassword, verifyPassword } from '~/server/utils/auth'
import { issueEmailVerificationInTx } from './emailVerification'
import { registrationEvent, validateRegistrationChoice } from '~/server/utils/registrationIntent'

// HU multi-organizacion (2026-09-04): "Registro" (Screen/Registro Paso 1-4
// del .pen, ver el flujo completo revisado con mcp__pencil__execute antes de
// tocar el frontend, pencil-antes-de-frontend) - una PERSONA nueva se crea a
// si misma junto con su PRIMERA organización, sin pasar por una invitación.
// Publico (POST /api/auth/register no pasa por el middleware de auth.ts) y
// SOLO en modo "saas" (getAppMode() !== 'dedicated' - un deployment de un
// solo cliente no tiene sentido que deje crear organizaciones nuevas, ver el
// check en el endpoint).
//
// Deliberadamente NO cubre a una persona YA existente que quiere sumar una
// organización nueva (el email ya existe -> RegistrationEmailExistsError,
// "iniciá sesión y creála desde ahí") - ese flujo ("Nueva organización"
// dentro de la app, ya logueado) queda fuera de esta entrega, documentado
// como gap explicito, no un descuido.

export class RegistrationEmailExistsError extends Error {}
export class SlugTakenError extends Error {}

const PG_UNIQUE_VIOLATION = '23505'

// Mismo criterio de forma que un subdominio real (letras/digitos en
// minuscula y guiones, sin empezar/terminar en guion) - el .pen lo muestra
// como "acme" en "acme.erpdinamico.com". No hay resolucion real por host
// detras (ver el comentario largo en tenants.slug, server/db/schema.ts) -
// esto solo garantiza que el valor mostrado sea unico y con buena forma.
export const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}

export async function isSlugAvailable(slug: string): Promise<boolean> {
  const [existing] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1)
  return !existing
}

export interface RegisterInput {
  fullName: string
  email: string
  password: string
  organizationName: string
  slug: string
  registrationChoice?: unknown
  prepareVerification?: boolean
}

export interface RegisterResult {
  tenantId: string
  tenantName: string
  slug: string
  personId: string
  userId: string
  adminRoleId: string
  memberRoleId: string
  resumed?: boolean
}

/**
 * Crea persona + organización + los dos roles de arranque (Administrador,
 * que se lleva la persona que se registra; Miembro, para quien se invite en
 * el Paso 3) + la membresia, todo en UNA transaccion. `withTenant()` no
 * sirve aca (necesita un tenantId que TODAVIA no existe) - se hace el mismo
 * `set_config('app.tenant_id', ...)` a mano, apenas se conoce el id del
 * tenant recien creado, antes de insertar en `users` (RLS real).
 */
export async function registerTenant(input: RegisterInput): Promise<RegisterResult> {
  const normalizedEmail = input.email.trim().toLowerCase()
  const normalizedSlug = input.slug.trim().toLowerCase()
  const choice = await validateRegistrationChoice(input.registrationChoice)
  registrationEvent('registration_started', choice)

  return db.transaction(async (tx) => {
    // Serializa también los dobles envíos antes de que exista una fila que bloquear.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${normalizedEmail},195))`)
    const [existingPerson] = await tx.select().from(people).where(eq(people.email, normalizedEmail)).limit(1)
    if (existingPerson) {
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.slug, normalizedSlug)).limit(1)
      if (tenant?.onboardingStatus === 'email_pending' && !existingPerson.emailVerifiedAt
        && tenant.name === input.organizationName.trim() && existingPerson.fullName === input.fullName.trim()
        && await verifyPassword(input.password, existingPerson.passwordHash)) {
        await tx.execute(sql`select set_config('app.person_id', ${existingPerson.id}, true),set_config('app.tenant_id', ${tenant.id}, true)`)
        const [membership] = await tx.select().from(users).where(and(eq(users.personId, existingPerson.id), eq(users.tenantId, tenant.id))).limit(1)
        const tenantRoles = await tx.select().from(roles).where(eq(roles.tenantId, tenant.id))
        const admin = tenantRoles.find(role => role.name === 'Administrador'), member = tenantRoles.find(role => role.name === 'Miembro')
        if (membership?.tenantId === tenant.id && membership.roleId === admin?.id && admin && member) {
          const issued = await tx.execute(sql`select id from email_verification_tokens where person_id=${existingPerson.id}::uuid and tenant_id=${tenant.id}::uuid and used_at is null limit 1`)
          if (input.prepareVerification && !issued.length) await issueEmailVerificationInTx(tx as unknown as typeof db, existingPerson.id, tenant.id, true)
          return { tenantId: tenant.id, tenantName: tenant.name, slug: tenant.slug!, personId: existingPerson.id, userId: membership.id, adminRoleId: admin.id, memberRoleId: member.id, resumed: true }
        }
      }
      throw new RegistrationEmailExistsError('No se pudo completar el registro con estos datos. Inicia sesión o recupera tu acceso.')
    }

    let tenant: typeof tenants.$inferSelect
    try {
      ;[tenant] = await tx.insert(tenants).values({ name: input.organizationName.trim(), slug: normalizedSlug, email: normalizedEmail, onboardingStatus: 'email_pending', registrationIntent: choice ? { ...choice, expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() } : null }).returning()
    } catch (err) {
      const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code
      if (code === PG_UNIQUE_VIOLATION) {
        throw new SlugTakenError('No se pudo completar el registro con estos datos. Inicia sesión o recupera tu acceso.')
      }
      throw err
    }

    await tx.execute(sql`select set_config('app.tenant_id', ${tenant.id}, true),set_config('app.person_id','00000000-0000-0000-0000-000000000000',true)`)

    const [adminRole] = await tx.insert(roles).values({ tenantId: tenant.id, name: 'Administrador', isSystem: true }).returning()
    const [memberRole] = await tx.insert(roles).values({ tenantId: tenant.id, name: 'Miembro', isSystem: false }).returning()

    const passwordHash = await hashPassword(input.password)
    const [person] = await tx.insert(people).values({ email: normalizedEmail, passwordHash, fullName: input.fullName.trim(), emailVerifiedAt: null }).returning()

    const [membership] = await tx.insert(users).values({ tenantId: tenant.id, personId: person.id, roleId: adminRole.id, isActive: true }).returning()
    if (input.prepareVerification) await issueEmailVerificationInTx(tx as unknown as typeof db, person.id, tenant.id, true)

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      slug: tenant.slug,
      personId: person.id,
      userId: membership.id,
      adminRoleId: adminRole.id,
      memberRoleId: memberRole.id
    }
  })
}
