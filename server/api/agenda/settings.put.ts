import { withTenant } from '~/server/db'
import { agendaSettings } from '~/server/db/schema'
import { agendaActor, agendaMutationLock, requireAgendaBase, requireAgendaSession } from '~/server/utils/agendaAdmin'
import { agendaSettingsSchema } from '~/utils/agenda'
export default defineEventHandler(async event => {
  const auth = requireAgendaSession(event), body = await readValidatedBody(event, agendaSettingsSchema.parse)
  return withTenant(auth.tenantId, async tx => {
    await requireAgendaBase(tx, auth.tenantId)
    if (!(await agendaActor(tx, auth, null)).manage) throw createError({ statusCode: 403, statusMessage: 'Solo Recepción o administradores pueden editar los ajustes de agenda.' })
    await agendaMutationLock(tx, auth.tenantId)
    const [row] = await tx.insert(agendaSettings).values({ ...body, tenantId: auth.tenantId }).onConflictDoUpdate({ target: agendaSettings.tenantId, set: body }).returning()
    return row
  })
})
