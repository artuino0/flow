import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, eq, lt, sql } from 'drizzle-orm'
import { createError, getCookie, setCookie, type H3Event } from 'h3'
import { db } from '~/server/db'
import { jobQueue, pendingRegistrations, people, registrationReceipts, roles, tenants, users } from '~/server/db/schema'
import { hashPassword } from './auth'
import { validateRegistrationChoice } from './registrationIntent'
import { matchesVerificationCode, newVerificationCode, verificationHash } from './verificationCode'
import { encryptSetting } from './settingsCrypto'
import { enqueueCriticalEmailInTx } from './criticalEmail'
import { inviteUserInTx } from './users'
import { SlugTakenError } from './registration'

export const CHALLENGE_COOKIE = 'flow_registration_challenge'
export const WITNESS_COOKIE = 'flow_registration_witness'
const MINUTE = 60_000, HOUR = 60 * MINUTE
type Pending = typeof pendingRegistrations.$inferSelect
export const registrationTokenHash = (value: string) => createHash('sha256').update(value).digest('hex')
const invalid = () => createError({ statusCode: 401, statusMessage: 'Verifica tu correo para continuar el registro.' })
/** Una excepción SQL puede contener parámetros privados. Nunca llega a HTTP. */
export async function publicRegistrationOperation<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation() }
  catch (error) {
    if (error instanceof SlugTakenError) throw createError({ statusCode: 409, statusMessage: error.message })
    const status = (error as { statusCode?: number }).statusCode
    if (status && status >= 400 && status < 500) throw error
    throw createError({ statusCode: 500, statusMessage: 'No pudimos confirmar la respuesta. Reintenta para continuar tu registro.' })
  }
}
function days(name: string, fallback: number) {
  const value = Number(process.env[name] || fallback)
  if (!Number.isInteger(value) || value < 1 || value > 365) throw new Error(`${name} debe estar entre 1 y 365`)
  return value
}
export function registrationCookie(event: H3Event, name: string, value: string, maxAge: number) {
  setCookie(event, name, value, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/auth', maxAge })
}
export function challengeCookie(event: H3Event) { return getCookie(event, CHALLENGE_COOKIE) || '' }
export function witnessCookie(event: H3Event) { return getCookie(event, WITNESS_COOKIE) || '' }
function retryAfter(row: Pending) { return Math.max(0, Math.ceil((Date.parse(row.emissions.at(-1) || '') + MINUTE - Date.now()) / 1000)) }
async function lockChallenge(tx: typeof db, token: string) {
  const [row] = await tx.select().from(pendingRegistrations).where(eq(pendingRegistrations.challengeHash, registrationTokenHash(token))).for('update')
  if (!token || !row || row.expiresAt <= new Date()) throw invalid()
  return row
}
async function issue(tx: typeof db, row: Pending, email: string, knownAccount: boolean) {
  const now = new Date(), emissions = row.emissions.filter(date => Date.parse(date) > now.getTime() - HOUR)
  if (emissions.length >= 5 || retryAfter(row) > 0) throw createError({ statusCode: 429, statusMessage: 'Espera antes de solicitar otro código.', data: { retryAfter: Math.max(60, retryAfter(row)) } })
  let code = newVerificationCode(), codeHash = verificationHash(row.id, code)
  // Incluso una coincidencia aleatoria debe invalidar el código anterior.
  while (codeHash === row.codeHash) {
    code = newVerificationCode(); codeHash = verificationHash(row.id, code)
  }
  const updated = { email, codeHash, codeExpiresAt: new Date(now.getTime() + 15 * MINUTE), attempts: 0,
    emissions: [...emissions, now.toISOString()], verifiedAt: null, witnessHash: null, witnessExpiresAt: null,
    expiresAt: row.verifiedAt ? new Date(now.getTime() + days('PROVISIONAL_REGISTRATION_UNVERIFIED_DAYS', 1) * 24 * HOUR) : row.expiresAt }
  await tx.update(pendingRegistrations).set(updated).where(eq(pendingRegistrations.id, row.id))
  const html = knownAccount
    ? '<p>Ya tienes una cuenta en Flow. Inicia sesión o recupera tu acceso para continuar.</p>'
    : `<p>Escribe este código en Flow para confirmar tu correo:</p><p style="font-size:32px;font-weight:bold;letter-spacing:6px">${code}</p><p>Vence en 15 minutos. No lo compartas.</p><p>Después podrás crear tu organización.</p>`
  await tx.execute(sql`select set_config('app.tenant_id','00000000-0000-0000-0000-000000000000',true),set_config('app.pending_registration_id',${row.id},true)`)
  await enqueueCriticalEmailInTx(tx, null, { to: email, subject: 'Continúa tu registro en Flow', html: 'Contenido de registro protegido',
    encryptedHtml: encryptSetting(html), platform: true, purpose: 'registration', pendingRegistrationId: row.id, pendingCodeHash: codeHash })
  return { ...row, ...updated }
}

export async function startProvisionalRegistration(input: { fullName: string; email: string; password: string; registrationChoice?: unknown }, previousToken = '') {
  const email = input.email.trim().toLowerCase(), passwordHash = await hashPassword(input.password)
  const intent = await validateRegistrationChoice(input.registrationChoice)
  const token = randomBytes(32).toString('base64url'), id = randomUUID(), now = new Date()
  return db.transaction(async transaction => {
    const tx = transaction as unknown as typeof db
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${email},197))`)
    const [existing] = await tx.select().from(pendingRegistrations).where(eq(pendingRegistrations.email, email)).for('update')
    // Un inicio ajeno no reemplaza un pendiente vigente ni revela su existencia.
    if (existing && existing.expiresAt > now && existing.challengeHash !== registrationTokenHash(previousToken)) return { token, retryAfter: 60, delivery: 'queued' }
    if (existing && existing.expiresAt > now) {
      if (retryAfter(existing) > 0 || existing.emissions.filter(date => Date.parse(date) > Date.now() - HOUR).length >= 5) {
        return { token: previousToken, retryAfter: 60, delivery: 'queued' }
      }
    }
    if (existing) await tx.delete(pendingRegistrations).where(eq(pendingRegistrations.id, existing.id))
    const [person] = await tx.select({ id: people.id }).from(people).where(eq(people.email, email))
    const [row] = await tx.insert(pendingRegistrations).values({ id, email, fullName: input.fullName.trim(), passwordHash, intent,
      challengeHash: registrationTokenHash(token), codeHash: verificationHash(id, newVerificationCode()), codeExpiresAt: now,
      emissions: existing?.emissions ?? [], expiresAt: new Date(now.getTime() + days('PROVISIONAL_REGISTRATION_UNVERIFIED_DAYS', 1) * 24 * HOUR) }).returning()
    await issue(tx, row!, email, Boolean(person))
    return { token, retryAfter: 60, delivery: 'queued' }
  })
}

export async function resendProvisionalRegistration(token: string, changeTo?: string) {
  return db.transaction(async transaction => {
    const tx = transaction as unknown as typeof db
    const [found] = await tx.select({ email: pendingRegistrations.email }).from(pendingRegistrations).where(eq(pendingRegistrations.challengeHash, registrationTokenHash(token)))
    if (!found) throw invalid()
    const email = changeTo?.trim().toLowerCase() || found.email
    for (const address of [...new Set([found.email, email])].sort()) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${address},197))`)
    const row = await lockChallenge(tx, token)
    const [other] = await tx.select({ id: pendingRegistrations.id }).from(pendingRegistrations).where(eq(pendingRegistrations.email, email))
    if (other && other.id !== row.id) throw createError({ statusCode: 409, statusMessage: 'No se pudo cambiar el correo. Revisa la dirección e intenta de nuevo.' })
    const [person] = await tx.select({ id: people.id }).from(people).where(eq(people.email, email))
    await issue(tx, row, email, Boolean(person))
    return { ok: true, email, retryAfter: 60, delivery: 'queued' }
  })
}

export async function verifyProvisionalRegistration(token: string, code: string) {
  const result = await db.transaction(async transaction => {
    const tx = transaction as unknown as typeof db, row = await lockChallenge(tx, token), now = new Date()
    if (row.verifiedAt || row.attempts >= 5 || row.codeExpiresAt <= now) return null
    await tx.update(pendingRegistrations).set({ attempts: row.attempts + 1 }).where(eq(pendingRegistrations.id, row.id))
    const matches = matchesVerificationCode(row.id, code, row.codeHash)
    const [person] = await tx.select({ id: people.id }).from(people).where(eq(people.email, row.email))
    if (!matches || person) return null
    const witness = randomBytes(32).toString('base64url')
    await tx.update(pendingRegistrations).set({ verifiedAt: now, witnessHash: registrationTokenHash(witness), witnessExpiresAt: new Date(now.getTime() + 30 * MINUTE),
      expiresAt: new Date(now.getTime() + days('PROVISIONAL_REGISTRATION_VERIFIED_DAYS', 7) * 24 * HOUR) }).where(eq(pendingRegistrations.id, row.id))
    return witness
  })
  // Fuera de la transacción: el intento fallido debe quedar confirmado.
  if (!result) throw createError({ statusCode: 400, statusMessage: 'El código no es válido o ya venció. Solicita uno nuevo.' })
  return result
}

export async function provisionalRegistrationStatus(challenge: string, witness: string) {
  const [row] = await db.select().from(pendingRegistrations).where(eq(pendingRegistrations.challengeHash, registrationTokenHash(challenge)))
  if (!challenge || !row || row.expiresAt <= new Date()) return { pending: false }
  const verified = Boolean(witness && row.verifiedAt && row.witnessHash === registrationTokenHash(witness) && row.witnessExpiresAt && row.witnessExpiresAt > new Date())
  const [job] = await db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.tenant_id','00000000-0000-0000-0000-000000000000',true),set_config('app.pending_registration_id',${row.id},true)`)
    return tx.select({ status: jobQueue.status }).from(jobQueue).where(sql`payload->>'pendingCodeHash'=${row.codeHash}`).orderBy(sql`created_at desc`).limit(1)
  })
  return { pending: true, verified, email: row.email, fullName: row.fullName, registrationChoice: row.intent, retryAfter: retryAfter(row),
    delivery: job?.status === 'dead' ? 'failed' : job?.status === 'succeeded' ? 'sent' : 'queued' }
}

export async function clearProvisionalIntent(challenge: string) {
  return db.transaction(async transaction => {
    const tx = transaction as unknown as typeof db, row = await lockChallenge(tx, challenge)
    await tx.update(pendingRegistrations).set({ intent: null }).where(eq(pendingRegistrations.id, row.id))
    return { ok: true }
  })
}

export interface CompleteRegistrationInput { organizationName: string; slug: string; invitees?: { email: string }[] }
export interface CompletedRegistration { tenantId: string; tenantName: string; slug: string; personId: string; userId: string; adminRoleId: string; memberRoleId: string; invitationsQueued: number; invitationsFailed: number; resumed?: boolean }
export async function completeProvisionalRegistration(witness: string, input: CompleteRegistrationInput): Promise<CompletedRegistration> {
  if (!witness) throw invalid()
  const witnessHash = registrationTokenHash(witness), requestHash = registrationTokenHash(JSON.stringify(input))
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${witnessHash},197))`)
    const [receipt] = await tx.select().from(registrationReceipts).where(eq(registrationReceipts.witnessHash, witnessHash))
    if (receipt) {
      if (receipt.expiresAt <= new Date() || receipt.requestHash !== requestHash) throw invalid()
      return { ...(receipt.result as unknown as CompletedRegistration), resumed: true }
    }
    const [row] = await tx.select().from(pendingRegistrations).where(eq(pendingRegistrations.witnessHash, witnessHash)).for('update')
    if (!row?.verifiedAt || !row.witnessExpiresAt || row.witnessExpiresAt <= new Date() || row.expiresAt <= new Date()) throw invalid()
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${row.email},195))`)
    const [personExists] = await tx.select({ id: people.id }).from(people).where(eq(people.email, row.email))
    if (personExists) throw invalid()
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.slug},198))`)
    const [slugExists] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, input.slug))
    if (slugExists) throw new SlugTakenError('Ese identificador ya está en uso, prueba con otro.')
    const intent = await validateRegistrationChoice(row.intent, tx)
    const [tenant] = await tx.insert(tenants).values({ name: input.organizationName, slug: input.slug, email: row.email, onboardingStatus: 'plan_pending',
      registrationIntent: intent ? { ...intent, expiresAt: new Date(Date.now() + 30 * 24 * HOUR).toISOString() } : null }).returning()
    await tx.execute(sql`select set_config('app.tenant_id',${tenant!.id},true),set_config('app.person_id','00000000-0000-0000-0000-000000000000',true)`)
    const [admin] = await tx.insert(roles).values({ tenantId: tenant!.id, name: 'Administrador', isSystem: true }).returning()
    const [member] = await tx.insert(roles).values({ tenantId: tenant!.id, name: 'Miembro', isSystem: false }).returning()
    const [person] = await tx.insert(people).values({ email: row.email, fullName: row.fullName, passwordHash: row.passwordHash, emailVerifiedAt: row.verifiedAt }).returning()
    const [user] = await tx.insert(users).values({ tenantId: tenant!.id, personId: person!.id, roleId: admin!.id, isActive: true }).returning()
    let invitationsQueued = 0, invitationsFailed = 0
    for (const invitee of input.invitees ?? []) {
      try {
        // Un fallo parcial revierte solo esa invitación; las aceptadas y el alta
        // se confirman en la misma transacción exterior.
        await tx.transaction(savepoint => inviteUserInTx(savepoint as unknown as typeof db, tenant!.id, invitee.email, member!.id, row.fullName))
        invitationsQueued++
      } catch { invitationsFailed++ }
    }
    const result = { tenantId: tenant!.id, tenantName: tenant!.name, slug: tenant!.slug!, personId: person!.id, userId: user!.id,
      adminRoleId: admin!.id, memberRoleId: member!.id, invitationsQueued, invitationsFailed }
    await tx.insert(registrationReceipts).values({ witnessHash, requestHash, result, expiresAt: row.witnessExpiresAt })
    await tx.delete(pendingRegistrations).where(eq(pendingRegistrations.id, row.id))
    return result
  })
}

export async function purgeProvisionalRegistrations() {
  return db.transaction(async tx => {
    const rows = await tx.select({ id: pendingRegistrations.id }).from(pendingRegistrations).where(lt(pendingRegistrations.expiresAt, new Date())).limit(100).for('update', { skipLocked: true })
    for (const row of rows) {
      await tx.execute(sql`select set_config('app.tenant_id','00000000-0000-0000-0000-000000000000',true),set_config('app.pending_registration_id',${row.id},true)`)
      await tx.delete(jobQueue).where(and(sql`tenant_id is null`, sql`payload->>'pendingRegistrationId'=${row.id}`))
      await tx.delete(pendingRegistrations).where(eq(pendingRegistrations.id, row.id))
    }
    await tx.delete(registrationReceipts).where(lt(registrationReceipts.expiresAt, new Date()))
    return rows.length
  })
}
