import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { emailVerificationTokens, people, tenants, users } from '~/server/db/schema'
import { enqueueEmail } from '~/server/utils/jobQueue'
import { escapeHtml, getAppBaseUrl, resolveSmtpConfig, SmtpNotConfiguredError } from '~/server/utils/mailer'
import { logger } from '~/server/utils/logger'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export class VerificationRateLimitError extends Error {}
export class VerificationEmailExistsError extends Error {}

export function canResendVerification(created: Date[], now = new Date(), allowImmediate = false): boolean {
  return created.filter(date => now.getTime() - date.getTime() < HOUR_MS).length < 5
    && (allowImmediate || created.every(date => now.getTime() - date.getTime() >= 60_000))
}

export async function assertVerificationDelivery(tenantId?: string): Promise<void> {
  try { await resolveSmtpConfig(tenantId) }
  catch (error) {
    if (error instanceof SmtpNotConfiguredError && process.env.NODE_ENV === 'development') return
    throw error
  }
}

export async function issueEmailVerification(personId: string, tenantId: string, allowImmediate = false, changeToEmail?: string): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const email = await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM people WHERE id = ${personId}::uuid FOR UPDATE`)
    const [person] = await tx.select({ email: people.email, verifiedAt: people.emailVerifiedAt }).from(people).where(eq(people.id, personId))
    if (!person || person.verifiedAt) throw createError({ statusCode: 409, statusMessage: 'El correo ya está verificado' })
    if (changeToEmail) {
      const [tenant] = await tx.select({ status: tenants.onboardingStatus }).from(tenants).where(eq(tenants.id, tenantId))
      if (tenant?.status !== 'email_pending') throw createError({ statusCode: 409, statusMessage: 'El correo ya fue confirmado' })
      const [other] = await tx.select({ id: people.id }).from(people).where(eq(people.email, changeToEmail))
      if (other && other.id !== personId) throw new VerificationEmailExistsError('Ese correo ya pertenece a otra cuenta')
    }
    const recent = await tx.select({ createdAt: emailVerificationTokens.createdAt }).from(emailVerificationTokens)
      .where(and(eq(emailVerificationTokens.personId, personId), gt(emailVerificationTokens.createdAt, new Date(now.getTime() - HOUR_MS))))
    if (!canResendVerification(recent.map(row => row.createdAt), now, allowImmediate)) throw new VerificationRateLimitError('Espera antes de solicitar otro correo de verificación')
    if (changeToEmail) await tx.update(people).set({ email: changeToEmail, emailVerifiedAt: null, updatedAt: now }).where(eq(people.id, personId))
    await tx.update(emailVerificationTokens).set({ usedAt: now }).where(and(eq(emailVerificationTokens.personId, personId), isNull(emailVerificationTokens.usedAt)))
    await tx.insert(emailVerificationTokens).values({ personId, tenantId, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + DAY_MS) })
    return changeToEmail ?? person.email
  })
  const link = `${getAppBaseUrl()}/verificar-correo?token=${encodeURIComponent(token)}`
  try {
    await resolveSmtpConfig(tenantId)
    await enqueueEmail(tenantId, {
      to: email,
      subject: 'Confirma tu correo para comenzar en Flow',
      html: `<p>Confirma tu correo para elegir un plan y activar tu organización.</p><p><a href="${escapeHtml(link)}">Verificar correo</a></p><p>El enlace vence en 24 horas y solo se puede usar una vez.</p>`
    })
  } catch (error) {
    if (error instanceof SmtpNotConfiguredError && process.env.NODE_ENV === 'development') {
      logger.info('development_email_verification_link', { link })
      return
    }
    throw error
  }
}

export async function confirmEmailVerification(token: string): Promise<boolean> {
  return db.transaction(async tx => {
    const [used] = await tx.update(emailVerificationTokens).set({ usedAt: new Date() })
      .where(and(eq(emailVerificationTokens.tokenHash, hashToken(token)), isNull(emailVerificationTokens.usedAt), gt(emailVerificationTokens.expiresAt, new Date())))
      .returning({ personId: emailVerificationTokens.personId, tenantId: emailVerificationTokens.tenantId })
    if (!used) return false
    await tx.update(people).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(people.id, used.personId))
    await tx.update(tenants).set({ onboardingStatus: 'plan_pending', updatedAt: new Date() })
      .where(and(eq(tenants.id, used.tenantId), eq(tenants.onboardingStatus, 'email_pending')))
    return true
  })
}

export async function registrationPerson(tenantId: string, userId: string) {
  const [membership] = await withTenant(tenantId, tx => tx.select({ personId: users.personId }).from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId))).limit(1))
  if (!membership) throw createError({ statusCode: 404, statusMessage: 'Cuenta no encontrada' })
  const [person] = await db.select({ id: people.id, email: people.email, verifiedAt: people.emailVerifiedAt }).from(people).where(eq(people.id, membership.personId))
  if (!person) throw createError({ statusCode: 404, statusMessage: 'Cuenta no encontrada' })
  return person
}
