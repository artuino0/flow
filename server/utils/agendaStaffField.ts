import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '~/server/db'
import { entities, entityFields } from '~/server/db/schema'
import { invalidateTenantAccess } from './shortCache'

/** Upgrade acotado: solo el filtro original, nunca configuraciones personalizadas. */
export async function upgradeAgendaStaffField(tx: typeof db, tenantId: string, entityId: string) {
  const [owner] = await tx.select({ id: entities.id }).from(entities).where(and(eq(entities.id, entityId), eq(entities.tenantId, tenantId),
    eq(entities.slug, 'agenda-citas'), eq(entities.templateKey, 'agenda'), isNull(entities.deletedAt))).limit(1)
  if (!owner) return
  const changed = await tx.update(entityFields).set({ validationRules: { agendaStaff: true } }).where(and(
    eq(entityFields.entityId, owner.id), eq(entityFields.name, 'personal'), eq(entityFields.dataType, 'user'),
    sql`${entityFields.validationRules} = '{"roles":["Personal"]}'::jsonb`
  )).returning({ id: entityFields.id })
  if (changed.length) invalidateTenantAccess(tenantId)
}
