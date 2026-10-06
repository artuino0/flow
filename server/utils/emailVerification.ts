import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db, withTenant } from '~/server/db'
import { emailVerificationTokens, people, tenants, users } from '~/server/db/schema'
import { enqueueCriticalEmailInTx } from '~/server/utils/criticalEmail'
import { escapeHtml, getAppBaseUrl } from '~/server/utils/mailer'
import { matchesVerificationCode, newVerificationCode, verificationHash } from './verificationCode'
import { encryptSetting } from './settingsCrypto'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const HOUR_MS = 3600_000
export class VerificationRateLimitError extends Error {}
export class VerificationEmailExistsError extends Error {}
export function canResendVerification(created: Date[], now = new Date(), allowImmediate = false): boolean {
  return created.filter(date => now.getTime() - date.getTime() < HOUR_MS).length < 5
    && (allowImmediate || created.every(date => now.getTime() - date.getTime() >= 60_000))
}

/** Solo configuración de plataforma: nunca conecta al proveedor. */
export async function assertVerificationDelivery(): Promise<void> {
  const { platformMailStatus } = await import('./mailTransport')
  const status = await platformMailStatus()
  if (status.status !== 'ok') throw createError({ statusCode: 503, statusMessage: status.reason })
}

/** Cuenta, código y correo pendiente se confirman juntos. El worker descifra al enviar. */
export async function issueEmailVerificationInTx(tx: typeof db, personId: string, tenantId: string, allowImmediate = false, changeToEmail?: string) {
  const now = new Date()
  await tx.execute(sql`SELECT id FROM people WHERE id = ${personId}::uuid FOR UPDATE`)
  await tx.execute(sql`select set_config('app.person_id', ${personId}, true), set_config('app.tenant_id', ${tenantId}, true)`)
  const [person] = await tx.select().from(people).where(eq(people.id, personId))
  if (!person || person.emailVerifiedAt) throw createError({ statusCode: 409, statusMessage: 'El correo ya está verificado' })
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId))
  if (tenant?.onboardingStatus !== 'email_pending') throw createError({ statusCode: 409, statusMessage: 'El correo ya fue confirmado' })
  const recent = await tx.select({ createdAt: emailVerificationTokens.createdAt }).from(emailVerificationTokens)
    .where(and(eq(emailVerificationTokens.personId, personId), gt(emailVerificationTokens.createdAt, new Date(now.getTime() - HOUR_MS))))
  if (!canResendVerification(recent.map(row => row.createdAt), now, allowImmediate)) throw new VerificationRateLimitError('Espera antes de solicitar otro código de verificación')
  if (changeToEmail) {
    const [other] = await tx.select({ id: people.id }).from(people).where(eq(people.email, changeToEmail))
    if (other && other.id !== personId) throw new VerificationEmailExistsError('No se pudo cambiar el correo. Revisa la dirección e intenta de nuevo.')
    await tx.update(people).set({ email: changeToEmail, updatedAt: now }).where(eq(people.id, personId))
    await tx.update(tenants).set({ email: changeToEmail, updatedAt: now }).where(eq(tenants.id, tenantId))
  }
  await tx.update(emailVerificationTokens).set({ usedAt: now }).where(and(eq(emailVerificationTokens.personId, personId), isNull(emailVerificationTokens.usedAt)))
  const id = randomUUID(), code = newVerificationCode(), token = randomBytes(32).toString('base64url')
  await tx.insert(emailVerificationTokens).values({ id, personId, tenantId, tokenHash: hashToken(token),
    codeHash: verificationHash(id, code), codeExpiresAt: new Date(now.getTime() + 15 * 60_000), expiresAt: new Date(now.getTime() + 24 * HOUR_MS) })
  const link = `${getAppBaseUrl()}/verificar-correo?token=${encodeURIComponent(token)}`
  const html = `<p>Escribe este código en Flow para confirmar tu correo:</p><p style="font-size:32px;font-weight:bold;letter-spacing:6px">${code}</p><p>Vence en 15 minutos. No lo compartas.</p><p>También puedes <a href="${escapeHtml(link)}">verificar tu correo con este enlace</a>. El enlace vence en 24 horas.</p>`
  return enqueueCriticalEmailInTx(tx, tenantId, { to: changeToEmail ?? person.email, subject: 'Confirma tu correo para comenzar en Flow',
    html: 'Contenido de verificación protegido', encryptedHtml: encryptSetting(html), platform: true, purpose: 'verification', verificationId: id })
}

export async function issueEmailVerification(personId: string, tenantId: string, allowImmediate = false, changeToEmail?: string): Promise<void> {
  await db.transaction(tx => issueEmailVerificationInTx(tx as unknown as typeof db, personId, tenantId, allowImmediate, changeToEmail))
}

async function confirmInTx(tx: typeof db, row: typeof emailVerificationTokens.$inferSelect) {
  const now = new Date()
  await tx.update(emailVerificationTokens).set({ usedAt: now }).where(and(eq(emailVerificationTokens.personId, row.personId), isNull(emailVerificationTokens.usedAt)))
  await tx.update(people).set({ emailVerifiedAt: now, updatedAt: now }).where(eq(people.id, row.personId))
  await tx.update(tenants).set({ onboardingStatus: 'plan_pending', updatedAt: now })
    .where(and(eq(tenants.id, row.tenantId), eq(tenants.onboardingStatus, 'email_pending')))
  return true
}
export async function confirmEmailVerification(token: string): Promise<boolean> {
  return db.transaction(async tx => {
    const [found] = await tx.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.tokenHash, hashToken(token)))
    if (!found) return false
    await tx.execute(sql`SELECT id FROM people WHERE id = ${found.personId}::uuid FOR UPDATE`)
    const [row] = await tx.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.id, found.id))
    if (!row || row.usedAt || row.expiresAt <= new Date()) return false
    return confirmInTx(tx as unknown as typeof db, row)
  })
}
export async function confirmVerificationCode(personId: string, tenantId: string, code: string): Promise<boolean> {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM people WHERE id = ${personId}::uuid FOR UPDATE`)
    const [row] = await tx.select().from(emailVerificationTokens).where(and(eq(emailVerificationTokens.personId, personId), eq(emailVerificationTokens.tenantId, tenantId), isNull(emailVerificationTokens.usedAt))).orderBy(desc(emailVerificationTokens.createdAt)).limit(1)
    if (!row?.codeHash || !row.codeExpiresAt || row.codeExpiresAt <= new Date() || row.attempts >= 5) return false
    await tx.update(emailVerificationTokens).set({ attempts: row.attempts + 1 }).where(eq(emailVerificationTokens.id, row.id))
    if (!matchesVerificationCode(row.id, code, row.codeHash)) return false
    return confirmInTx(tx as unknown as typeof db, row)
  })
}
export async function verificationStatus(personId: string, tenantId: string) {
  const [row] = await db.select().from(emailVerificationTokens).where(and(eq(emailVerificationTokens.personId, personId), eq(emailVerificationTokens.tenantId, tenantId))).orderBy(desc(emailVerificationTokens.createdAt)).limit(1)
  const [job] = row ? await withTenant(tenantId, tx => tx.execute(sql`select status from job_queue where tenant_id=${tenantId}::uuid and payload->>'verificationId'=${row.id} order by created_at desc limit 1`)) : []
  const [invitations] = await withTenant(tenantId, tx => tx.execute(sql`select count(*) filter(where status='dead')::int as failed from job_queue where tenant_id=${tenantId}::uuid and payload->>'purpose'='invitation'`))
  return { retryAfter: row ? Math.max(0, Math.ceil((row.createdAt.getTime() + 60_000 - Date.now()) / 1000)) : 0,
    delivery: job?.status === 'dead' ? 'failed' : job?.status === 'succeeded' ? 'sent' : 'queued', invitationFailures: Number(invitations?.failed ?? 0) }
}
export async function registrationPerson(tenantId: string, userId: string) {
  const [membership] = await withTenant(tenantId, tx => tx.select({ personId: users.personId }).from(users).where(and(eq(users.id, userId), eq(users.tenantId, tenantId))).limit(1))
  if (!membership) throw createError({ statusCode: 404, statusMessage: 'Cuenta no encontrada' })
  const [person] = await db.select({ id: people.id, email: people.email, verifiedAt: people.emailVerifiedAt }).from(people).where(eq(people.id, membership.personId))
  if (!person) throw createError({ statusCode: 404, statusMessage: 'Cuenta no encontrada' })
  return person
}
