import { isDeepStrictEqual } from 'node:util'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { tenants, tenantSubscriptions, plans, entities, entityFields, records, users, people, roles } from '~/server/db/schema'
import { withSystemRecordAccess } from './recordActorContext'
import { applyBlueprint } from './blueprint/apply'
import type { Blueprint, BlueprintField } from './blueprint/schema'
import { buildRecordSchema, applyFieldDefaults } from './fieldValidations/registry'
import { normalizeRegistrationChoice } from '~/utils/registrationIntent'
import { logger } from './logger'

const select = (name: string, label: string, values: string[], required = false): BlueprintField => ({ name, label, dataType: 'select', required, validationRules: { options: values.map(value => ({ value, label: value })) } })
const field = (name: string, label: string, dataType: BlueprintField['dataType'] = 'text'): BlueprintField => ({ name, label, dataType })
export const platformCrmBlueprint: Blueprint = {
  version: 1, summary: 'CRM de la empresa', associations: [], modules: [{
    ref: 'clientes', action: 'create', kind: 'dimension', name: 'Clientes', singularName: 'Cliente', slug: 'clientes', icon: 'Building2',
    description: 'Flow sincroniza nombre, estado, correo, plan, intervalo, MRR, fechas, usuarios, módulos, última actividad, fuente, organización y fecha de baja para origen Flow (SaaS). Contacto, teléfono, notas y campos propios se conservan. Desarrollo a la medida y Otro se capturan manualmente.',
    fields: [
      { ...field('nombre', 'Nombre'), required: true, validationRules: { notBlank: true } },
      { name: 'origen', label: 'Origen', dataType: 'select', required: true, validationRules: { options: [{ value: 'flow_saas', label: 'Flow (SaaS)' }, { value: 'desarrollo', label: 'Desarrollo a la medida' }, { value: 'otro', label: 'Otro' }] } },
      select('estado', 'Estado', ['Prospecto', 'En prueba', 'Activo', 'Impago', 'Cancelado', 'En proyecto', 'Finalizado']),
      field('contacto', 'Contacto'), field('correo', 'Correo'), field('telefono', 'Teléfono'),
      select('plan', 'Plan', ['Agenda', 'Starter', 'Crecimiento', 'Escala', 'Empresarial']), select('intervalo', 'Intervalo', ['Mensual', 'Anual']),
      { ...field('mrr', 'Ingreso mensual recurrente (MXN)', 'currency'), validationRules: { currency: 'MXN', decimals: 2 } },
      field('fecha_alta', 'Fecha de alta', 'date'), field('fin_prueba', 'Fin de prueba', 'date'), field('proximo_cobro', 'Próximo cobro', 'date'),
      field('usuarios', 'Usuarios activos', 'number'), field('modulos', 'Módulos activos', 'number'), field('ultima_actividad', 'Última actividad', 'date'),
      field('fuente', 'Fuente'), field('organizacion_id', 'Organización de Flow'), { ...field('notas', 'Notas'), validationRules: { maxLength: 20000 } }, field('fecha_baja', 'Fecha de baja', 'date')
    ]
  }]
}

export async function platformCrmDestination() {
  const slug = process.env.PLATFORM_CRM_TENANT_SLUG?.trim()
  if (!slug) return null
  const [tenant] = await db.select({ id: tenants.id, timezone: tenants.timezone }).from(tenants).where(eq(tenants.slug, slug)).limit(1)
  if (!tenant) logger.warn('platform_crm_destination_unavailable')
  return tenant ?? null
}

export async function installPlatformCrm(apply = false) {
  const destination = await platformCrmDestination()
  if (!destination) return { enabled: false, installed: false }
  const [existing] = await withTenant(destination.id, tx => tx.select().from(entities).where(and(eq(entities.slug, 'clientes'), eq(entities.tenantId, destination.id))).limit(1))
  if (existing) {
    const [application] = await withTenant(destination.id, tx => tx.execute(sql`select id from blueprint_applications where tenant_id = ${destination.id}::uuid and idempotency_key = 'platform:crm:v1' and undone_at is null`))
    if (!application || existing.deletedAt || !existing.isActive) throw new Error('El identificador Clientes ya está ocupado o el CRM fue retirado')
    return { enabled: true, installed: true }
  }
  if (apply) await applyBlueprint(destination.id, null, platformCrmBlueprint, 'platform:crm:v1')
  return { enabled: true, installed: apply }
}

export function platformClientState(status: string | null, newlyRegistered: boolean) {
  if (!status) return newlyRegistered ? 'Prospecto' : 'Cancelado'
  return ({ trialing: 'En prueba', active: 'Activo', past_due: 'Impago', unpaid: 'Impago' } as Record<string, string>)[status] ?? 'Cancelado'
}
export function platformClientMrr(provider: string | undefined, interval: string | undefined, monthly: number | null | undefined, annual: number | null | undefined, currency = 'MXN') {
  return (provider !== 'stripe' || currency !== 'MXN' ? 0 : interval === 'year' ? (annual ?? 0) / 1200 : (monthly ?? 0) / 100).toFixed(2)
}
export function platformClientSource(input: unknown) {
  const choice = normalizeRegistrationChoice(input)
  return choice ? ['plan', 'interval', 'utm_source', 'utm_medium', 'utm_campaign', 'ref'].flatMap(key => {
    const value = choice[key as keyof typeof choice]
    return value ? [`${key}=${value}`] : []
  }).join('; ') : ''
}
export type SyncResult = { status: 'created' | 'updated' | 'unchanged' | 'skipped'; fields: string[] }
type SyncOptions = { apply?: boolean; deleted?: { nombre: string; correo: string | null; fecha_alta: string; fecha_baja: string; fuente?: string } }

/** Candado transaccional en el destino, válido también entre procesos/réplicas. */
export async function syncPlatformClient(tenantId: string, options: SyncOptions = {}): Promise<SyncResult> {
  const destination = await platformCrmDestination()
  if (!destination || destination.id === tenantId) return { status: 'skipped', fields: [] }
  return withSystemRecordAccess(() => withTenant(destination.id, async tx => {
    await tx.execute(sql`set local statement_timeout = '10000'`)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${destination.id + ':' + tenantId}, 187))`)
    const [module] = await tx.select().from(entities).where(and(eq(entities.tenantId, destination.id), eq(entities.slug, 'clientes'), eq(entities.isActive, true), isNull(entities.deletedAt))).limit(1)
    if (!module) throw new Error('El CRM de plataforma aún no está instalado')
    const matches = await tx.select().from(records).where(and(eq(records.tenantId, destination.id), eq(records.entityId, module.id), sql`${records.customData}->>'organizacion_id' = ${tenantId}`)).for('update')
    if (matches.length > 1) throw new Error('Hay una llave de sincronización duplicada')
    const previous = matches[0]
    const old = (previous?.customData ?? {}) as Record<string, unknown>
    if (previous && old.origen !== 'flow_saas') return { status: 'skipped', fields: [] }
    // La lectura del origen tiene su propio contexto RLS; nunca se consulta su contenido.
    // Misma conexión: cambiar solo el tenant de lectura evita anidar pools/locks.
    // Se restaura el destino antes de validar y escribir; cualquier error revierte todo.
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`)
    const source = await (async () => {
      const origin = tx
      const [tenant] = await origin.select({ name: tenants.name, email: tenants.email, createdAt: tenants.createdAt, onboardingStatus: tenants.onboardingStatus, trialConsumedAt: tenants.trialConsumedAt, registrationIntent: tenants.registrationIntent, platformCrmAttribution: tenants.platformCrmAttribution }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
      if (!tenant) return null
      const [subscription] = await origin.select({ subscription: { provider: tenantSubscriptions.provider, status: tenantSubscriptions.status, billingInterval: tenantSubscriptions.billingInterval, stripeSubscriptionId: tenantSubscriptions.stripeSubscriptionId, trialEndsAt: tenantSubscriptions.trialEndsAt, currentPeriodEnd: tenantSubscriptions.currentPeriodEnd }, plan: { code: plans.code, monthlyPriceCents: plans.monthlyPriceCents, annualPriceCents: plans.annualPriceCents, currency: plans.currency } }).from(tenantSubscriptions).innerJoin(plans, eq(plans.id, tenantSubscriptions.planId)).where(eq(tenantSubscriptions.tenantId, tenantId)).limit(1)
      const [usage] = await origin.execute(sql`select
        (select count(*)::int from users where tenant_id = ${tenantId}::uuid and is_active) as users,
        (select count(*)::int from entities where tenant_id = ${tenantId}::uuid and is_active and deleted_at is null) as modules,
        (select max(last_seen_at) from auth_sessions where tenant_id = ${tenantId}::uuid) as activity`)
      const [owner] = await origin.select({ email: people.email }).from(users).innerJoin(people, eq(people.id, users.personId)).innerJoin(roles, eq(roles.id, users.roleId)).where(and(eq(users.tenantId, tenantId), eq(roles.isSystem, true))).orderBy(users.createdAt).limit(1)
      return { tenant, subscription, usage, owner }
    })()
    await tx.execute(sql`select set_config('app.tenant_id', ${destination.id}, true)`)
    const date = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null
    let desired: Record<string, unknown>
    if (!source) {
      if (!previous && !options.deleted) return { status: 'skipped', fields: [] }
      desired = { ...(previous ? {} : options.deleted), estado: 'Cancelado', fecha_baja: old.fecha_baja ?? options.deleted?.fecha_baja ?? new Date().toISOString(), mrr: '0.00', proximo_cobro: null, fin_prueba: null, usuarios: 0, modulos: 0 }
    } else {
      const { tenant, subscription, usage, owner } = source
      const s = subscription?.subscription, p = subscription?.plan
      // Starter manual/trialing sin fechas es el respaldo, no una contratación.
      const fallback = s?.provider === 'manual' && s.status === 'trialing' && !s.stripeSubscriptionId && !s.trialEndsAt && !s.currentPeriodEnd && !tenant.trialConsumedAt
      const state = platformClientState(fallback ? null : s?.status ?? null, tenant.onboardingStatus !== 'complete' && !tenant.trialConsumedAt)
      const sourceText = platformClientSource(tenant.registrationIntent) || platformClientSource(tenant.platformCrmAttribution) || String(old.fuente ?? '')
      const planName = p ? ({ agenda: 'Agenda', starter: 'Starter', crecimiento: 'Crecimiento', escala: 'Escala', empresarial: 'Empresarial' } as Record<string, string>)[p.code] ?? null : null
      desired = { nombre: tenant.name, correo: owner?.email ?? tenant.email, estado: state, plan: fallback ? null : planName, intervalo: fallback || !s ? null : s.billingInterval === 'year' ? 'Anual' : 'Mensual',
        mrr: state === 'Cancelado' ? '0.00' : platformClientMrr(s?.provider, s?.billingInterval, p?.monthlyPriceCents, p?.annualPriceCents, p?.currency), fecha_alta: date(tenant.createdAt),
        fin_prueba: date(s?.trialEndsAt), proximo_cobro: date(s?.currentPeriodEnd), usuarios: Number(usage.users), modulos: Number(usage.modules), ultima_actividad: date(usage.activity as string | null), fuente: sourceText, fecha_baja: null }
    }
    desired.organizacion_id = tenantId
    if (!previous) desired.origen = 'flow_saas'
    const fields = await tx.select().from(entityFields).where(eq(entityFields.entityId, module.id))
    const schema = buildRecordSchema(fields, { timezone: destination.timezone })
    const candidate = previous ? { ...old, ...desired } : applyFieldDefaults(fields, desired, { timezone: destination.timezone })
    const validated = JSON.parse(JSON.stringify(schema.parse(candidate))) as Record<string, unknown>
    const diff = Object.fromEntries(Object.keys(desired).filter(key => !isDeepStrictEqual(old[key], validated[key])).map(key => [key, validated[key]]))
    const restore = Boolean(previous?.deletedAt)
    if (previous && !Object.keys(diff).length && !restore) return { status: 'unchanged', fields: [] }
    if (options.apply !== false) {
      if (previous) await tx.update(records).set({ customData: sql`${records.customData} || ${JSON.stringify(diff)}::jsonb`, deletedAt: null, updatedAt: new Date() }).where(and(eq(records.id, previous.id), eq(records.tenantId, destination.id)))
      else await tx.insert(records).values({ tenantId: destination.id, entityId: module.id, customData: validated })
    }
    return { status: previous ? 'updated' : 'created', fields: Object.keys(diff) }
  }))
}

/** Recorre por páginas; errores individuales no interrumpen las demás organizaciones. */
export async function syncPlatformClients(options: { apply?: boolean; budgetMs?: number } = {}) {
  const summary = { created: 0, updated: 0, unchanged: 0, skipped: 0, errors: 0, incomplete: false }
  const destination = await platformCrmDestination()
  if (!destination) return summary
  const started = Date.now(), budget = options.budgetMs ?? 45_000
  let after = ''
  while (Date.now() - started < budget) {
    const page = await db.execute(sql`select id::text from tenants where id::text > ${after} order by id::text limit 50`)
    if (!page.length) return summary
    for (const row of page) {
      if (Date.now() - started >= budget) { summary.incomplete = true; return summary }
      after = String(row.id)
      try { const result = await syncPlatformClient(after, options); summary[result.status]++ }
      catch { summary.errors++; logger.warn('platform_crm_sync_failed') }
    }
  }
  summary.incomplete = true
  return summary
}
