import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { H3Event } from 'h3'
import { withTenant } from '~/server/db'
import { moduleDesignSessions } from '~/server/db/schema'
import { getTenantSubscription } from '~/server/utils/billing'
import { requireAdminRole } from '~/server/utils/rbac'
import { exportBlueprint } from '~/server/utils/blueprint/export'
import { validateBlueprint } from '~/server/utils/blueprint/validate'
import { diffBlueprint } from '~/server/utils/blueprint/diff'
import { applyBlueprint } from '~/server/utils/blueprint/apply'
import { generateDesign } from './generate'
import { containsUnsafeBlueprintText, trustedBlueprintStrings } from './safety'
import { recoverOrphanedAiReservations } from './credits'

export const instructionSchema = z.string().trim().min(1).max(4000)

export async function requireDesignerAccess(event: H3Event) {
  const auth = await requireAdminRole(event)
  const subscription = await getTenantSubscription(auth.tenantId)
  if (subscription?.plan.code === 'agenda') throw createError({ statusCode: 403, statusMessage: 'El diseñador de módulos no está disponible en el plan Agenda.' })
  return auth
}

export function sessionId(event: H3Event) {
  return z.string().uuid().parse(getRouterParam(event, 'id'))
}

export async function findSession(tenantId: string, id: string) {
  await recoverOrphanedAiReservations(tenantId, id)
  const [row] = await withTenant(tenantId, tx => tx.select().from(moduleDesignSessions).where(and(eq(moduleDesignSessions.id, id), eq(moduleDesignSessions.tenantId, tenantId))).limit(1))
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Sesión no encontrada' })
  return row
}

export async function createModuleDesignSession(tenantId: string, userId: string, prompt?: string) {
  const blueprint = await exportBlueprint(tenantId)
  const [session] = await withTenant(tenantId, tx => tx.insert(moduleDesignSessions).values({ tenantId, userId, blueprint }).returning())
  if (!prompt) return session!
  return { session: session!, result: await generateDesign(tenantId, session!.id, prompt) }
}

export async function listSessions(tenantId: string) {
  await recoverOrphanedAiReservations(tenantId)
  return withTenant(tenantId, tx => tx.select().from(moduleDesignSessions).where(eq(moduleDesignSessions.tenantId, tenantId)).orderBy(desc(moduleDesignSessions.updatedAt)).limit(100))
}

export async function editSessionBlueprint(tenantId: string, id: string, input: unknown) {
  const session = await findSession(tenantId, id)
  if (session.status !== 'draft' && session.status !== 'error') throw createError({ statusCode: 409, statusMessage: 'La sesión ya está cerrada' })
  if (session.processingAt) throw createError({ statusCode: 409, statusMessage: 'La sesión está procesando un mensaje' })
  const trusted = trustedBlueprintStrings(await exportBlueprint(tenantId))
  if (containsUnsafeBlueprintText(input, trusted)) throw createError({ statusCode: 422, statusMessage: 'El plano contiene código, SQL, URL o texto demasiado largo' })
  const checked = await validateBlueprint(tenantId, input)
  if (!checked.normalized || checked.errors.some(error => error.code !== 'plan_limit')) throw createError({ statusCode: 422, statusMessage: 'El plano contiene errores', data: { errors: checked.errors } })
  const diff = await diffBlueprint(tenantId, checked)
  const [updated] = await withTenant(tenantId, tx => tx.update(moduleDesignSessions).set({ blueprint: checked.normalized!, version: session.version + 1, status: 'draft', updatedAt: new Date() }).where(and(eq(moduleDesignSessions.id, id), eq(moduleDesignSessions.tenantId, tenantId), eq(moduleDesignSessions.version, session.version), inArray(moduleDesignSessions.status, ['draft', 'error']), isNull(moduleDesignSessions.processingAt))).returning())
  if (!updated) throw createError({ statusCode: 409, statusMessage: 'La sesión cambió; vuelve a cargarla' })
  return { session: updated, normalized: checked.normalized, errors: checked.errors, diff, merges: checked.merges }
}

export async function applySession(tenantId: string, userId: string, id: string) {
  const session = await findSession(tenantId, id)
  if (session.status === 'discarded') throw createError({ statusCode: 409, statusMessage: 'La sesión fue descartada' })
  if (session.processingAt) throw createError({ statusCode: 409, statusMessage: 'La sesión está procesando un mensaje' })
  if (session.status === 'error') throw createError({ statusCode: 409, statusMessage: 'Resuelve el error antes de aplicar el plano' })
  if (session.status === 'applied') return applyBlueprint(tenantId, userId, session.blueprint, id)
  const [claimed] = await withTenant(tenantId, tx => tx.update(moduleDesignSessions).set({ processingAt: new Date() }).where(and(eq(moduleDesignSessions.id, id), eq(moduleDesignSessions.tenantId, tenantId), eq(moduleDesignSessions.status, 'draft'), isNull(moduleDesignSessions.processingAt))).returning())
  if (!claimed) throw createError({ statusCode: 409, statusMessage: 'La sesión cambió; vuelve a cargarla' })
  try {
    const result = await applyBlueprint(tenantId, userId, claimed.blueprint, id)
    await withTenant(tenantId, tx => tx.update(moduleDesignSessions).set({ status: 'applied', processingAt: null, appliedAt: new Date(), updatedAt: new Date() }).where(and(eq(moduleDesignSessions.id, id), eq(moduleDesignSessions.tenantId, tenantId))))
    return result
  } catch (error) {
    await withTenant(tenantId, tx => tx.update(moduleDesignSessions).set({ processingAt: null }).where(and(eq(moduleDesignSessions.id, id), eq(moduleDesignSessions.tenantId, tenantId))))
    throw error
  }
}

export async function discardSession(tenantId: string, id: string) {
  const session = await findSession(tenantId, id)
  if (session.status === 'applied') throw createError({ statusCode: 409, statusMessage: 'La sesión ya fue aplicada' })
  if (session.processingAt) throw createError({ statusCode: 409, statusMessage: 'La sesión está procesando un mensaje' })
  const [updated] = await withTenant(tenantId, tx => tx.update(moduleDesignSessions).set({ status: 'discarded', discardedAt: new Date(), updatedAt: new Date() }).where(and(eq(moduleDesignSessions.id, id), eq(moduleDesignSessions.tenantId, tenantId), inArray(moduleDesignSessions.status, ['draft', 'error']), isNull(moduleDesignSessions.processingAt))).returning())
  if (!updated) throw createError({ statusCode: 409, statusMessage: 'La sesión cambió; vuelve a cargarla' })
  return updated
}
