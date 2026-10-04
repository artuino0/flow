import { and, eq, isNull } from 'drizzle-orm'
import { db } from '~/server/db'
import { agendaSiteSettings, agendaSettings, agendaSchedules, entities, records, users, people, roles } from '~/server/db/schema'
import { agendaSiteSettingsSchema } from '~/utils/agendaPublic'
import { analyzeAgendaMarkers, transformAgendaMarkers } from '~/utils/agendaMarkers'
import type { AgendaEditorPreviewState } from '~/utils/sitesAgendaPreview'
import { agendaBaseInTx, agendaSettingsInTx } from './agendaAdmin'
import { agendaStaff } from './agendaStaff'
import { agendaOpaqueId } from './agendaPublicSecurity'

/** Usa la transacción y el actor del guardado/publicación, sin elevar permisos. */
export async function agendaMarkerWarnings(tx: typeof db, tenantId: string, site: string, html: string) {
  if (!analyzeAgendaMarkers(html).length) return []
  const [saved] = await tx.select({ config: agendaSiteSettings.config }).from(agendaSiteSettings).where(and(eq(agendaSiteSettings.tenantId, tenantId), eq(agendaSiteSettings.siteId, site))).limit(1)
  const config = agendaSiteSettingsSchema.parse(saved?.config ?? {})
  const [organization] = await tx.select({ mode: agendaSettings.assignmentMode }).from(agendaSettings).where(eq(agendaSettings.tenantId, tenantId)).limit(1)
  const staff = await agendaStaff(tx, tenantId)
  const scheduled = await tx.select({ userId: agendaSchedules.userId }).from(agendaSchedules).where(eq(agendaSchedules.tenantId, tenantId))
  const services = await tx.select({ id: records.id, data: records.customData }).from(records).innerJoin(entities, eq(entities.id, records.entityId))
    .where(and(eq(records.tenantId, tenantId), eq(entities.tenantId, tenantId), eq(entities.slug, 'agenda-servicios'), eq(entities.templateKey, 'agenda'), eq(entities.isActive, true), isNull(entities.deletedAt), isNull(records.deletedAt)))
  return transformAgendaMarkers(html, { enabled: config.enabled, mode: config.assignmentMode ?? organization?.mode ?? 'both',
    people: staff.filter(p => p.name?.trim() && (!config.personalIds.length || config.personalIds.includes(p.id)) && scheduled.some(s => s.userId === p.id)).map(p => ({ id: agendaOpaqueId(site, 'person', p.id), name: p.name! })),
    services: services.filter(s => !config.serviceIds.length || config.serviceIds.includes(s.id)).map(s => ({ id: agendaOpaqueId(site, 'service', s.id), name: String((s.data as Record<string, unknown>).nombre ?? '') })) }).warnings
}


/** Configuración privada del preview, bajo el tenant y la capacidad Sites existentes. */
export async function agendaEditorPreviewState(tx: typeof db, tenantId: string, site: string): Promise<AgendaEditorPreviewState> {
  const [saved] = await tx.select({ config: agendaSiteSettings.config }).from(agendaSiteSettings).where(and(eq(agendaSiteSettings.tenantId, tenantId), eq(agendaSiteSettings.siteId, site))).limit(1)
  const config = agendaSiteSettingsSchema.parse(saved?.config ?? {})
  const base = await agendaBaseInTx(tx, tenantId), staff = await agendaStaff(tx, tenantId)
  const services = await tx.select({ id: records.id, data: records.customData }).from(records).innerJoin(entities, eq(entities.id, records.entityId))
    .where(and(eq(records.tenantId, tenantId), eq(entities.tenantId, tenantId), eq(entities.slug, 'agenda-servicios'), eq(entities.templateKey, 'agenda'), eq(entities.isActive, true), isNull(entities.deletedAt), isNull(records.deletedAt)))
  const missing: string[] = []
  if (!base) missing.push('Instala Citas base.')
  if (!config.enabled) missing.push('Activa la agenda para este sitio.')
  if (!services.some(service => (!config.serviceIds.length || config.serviceIds.includes(service.id)) && String((service.data as Record<string, unknown>).nombre ?? '').trim() && Number((service.data as Record<string, unknown>).duracion_minutos) > 0)) missing.push('Agrega al menos un servicio visible.')
  if (!staff.some(person => person.scheduled && person.name?.trim() && (!config.personalIds.length || config.personalIds.includes(person.id)))) missing.push('Define el horario de al menos una persona visible.')
  const organization = await agendaSettingsInTx(tx, tenantId)
  return { settings: config, missing, assignmentMode: config.assignmentMode ?? organization.settings.assignmentMode, timezone: organization.timezone }
}
