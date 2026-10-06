import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { db, withPerson } from '~/server/db'
import { passwordResetTokens, people, tenants, users } from '~/server/db/schema'
import { hashPassword } from '~/server/utils/auth'
import { enqueueCriticalEmailInTx } from '~/server/utils/criticalEmail'
import { escapeHtml, getAppBaseUrl } from '~/server/utils/mailer'
import { encryptSetting } from './settingsCrypto'
import { invalidateTenantSessions } from '~/server/utils/shortCache'
import { logger } from '~/server/utils/logger'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export async function requestPasswordReset(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase()
  const [person] = await db.select({ id: people.id, email: people.email }).from(people).where(eq(people.email, normalizedEmail)).limit(1)
  if (!person) return

  const memberships = await withPerson(person.id, tx => tx.select({ tenantId: users.tenantId }).from(users).innerJoin(tenants, eq(tenants.id, users.tenantId)).where(and(eq(users.personId, person.id), eq(users.isActive, true))).limit(1))
  if (!memberships.length) return

  const token = randomBytes(32).toString('base64url')
  const link = `${getAppBaseUrl()}/restablecer/${token}`
  const html = `<p>Recibimos una solicitud para cambiar la contraseña de tu cuenta.</p><p><a href="${escapeHtml(link)}">Crear una contraseña nueva</a></p><p>Este enlace vence en 60 minutos. Si no solicitaste el cambio, puedes ignorar este correo.</p>`
  await db.transaction(async tx => {
    // Serializa solicitudes de la misma persona para que solo quede un enlace vigente.
    await tx.execute(sql`SELECT id FROM people WHERE id = ${person.id}::uuid FOR UPDATE`)
    await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(and(eq(passwordResetTokens.personId, person.id), isNull(passwordResetTokens.usedAt)))
    await tx.insert(passwordResetTokens).values({ personId: person.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) })
    await tx.execute(sql`select set_config('app.tenant_id', ${memberships[0]!.tenantId}, true)`)
    await enqueueCriticalEmailInTx(tx as unknown as typeof db, memberships[0]!.tenantId, { to: person.email, platform: true, purpose: 'password-reset', subject: 'Restablece tu contraseña', html: 'Recuperación protegida', encryptedHtml: encryptSetting(html) })
  })
}

export async function passwordResetRateKey(token: string): Promise<string> {
  const [row] = await db.select({ email: people.email }).from(passwordResetTokens)
    .innerJoin(people, eq(people.id, passwordResetTokens.personId))
    .where(eq(passwordResetTokens.tokenHash, hashToken(token))).limit(1)
  return row?.email ?? `invalid:${hashToken(token)}`
}

export async function confirmPasswordReset(token: string, password: string): Promise<boolean> {
  const tokenHash = hashToken(token)
  const [reset] = await db.select({ id: passwordResetTokens.id, personId: passwordResetTokens.personId })
    .from(passwordResetTokens).where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date()))).limit(1)
  if (!reset) return false

  const passwordHash = await hashPassword(password)
  const memberships = await withPerson(reset.personId, tx => tx.select({ id: users.id, tenantId: users.tenantId }).from(users))
  const consumed = await db.transaction(async tx => {
    // La contraseña, el consumo del enlace y todas las revocaciones se confirman juntos.
    await tx.execute(sql`SELECT id FROM people WHERE id = ${reset.personId}::uuid FOR UPDATE`)
    const [row] = await tx.update(passwordResetTokens).set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.id, reset.id), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date())))
      .returning({ id: passwordResetTokens.id })
    if (!row) return false
    await tx.update(people).set({ passwordHash, updatedAt: new Date() }).where(eq(people.id, reset.personId))
    for (const membership of memberships) {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${membership.tenantId}, true)`)
      await tx.execute(sql`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = ${membership.id}::uuid AND revoked_at IS NULL`)
    }
    return true
  })
  if (!consumed) return false
  for (const membership of memberships) invalidateTenantSessions(membership.tenantId)
  logger.info('password_reset_completed')
  return true
}
