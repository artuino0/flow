import { z } from 'zod'
import { requirePermission } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { recordActivities } from '~/server/db/schema'
import { createNotifications, publishNotifications } from '~/server/utils/notifications'

const bodySchema = z.object({
  actionType: z.enum(['NOTE', 'EMAIL', 'CALL', 'TASK']),
  details: z.object({
    text: z.string().optional(),
    mentions: z.array(z.string().uuid()).optional(),
    notifyUserIds: z.array(z.string().uuid()).optional(),
    notifyRoleIds: z.array(z.string().uuid()).optional(),
    notifyGroupIds: z.array(z.string().uuid()).optional()
  }).passthrough()
})

export default defineEventHandler(async (event) => {
  const entitySlug = getRouterParam(event, 'entity')!
  const id = getRouterParam(event, 'id')!
  // Requerimos permiso de update para poder agregar notas al registro
  const { auth, entity } = await requirePermission(event, entitySlug, 'canUpdate')
  const body = await readValidatedBody(event, bodySchema.parse)

  const result = await withTenant(auth.tenantId, async (tx) => {
    const { mentions = [], notifyUserIds = [], notifyRoleIds = [], notifyGroupIds = [], ...activityDetails } = body.details
    if (mentions.length) activityDetails.mentions = mentions
    const [r] = await tx.insert(recordActivities).values({
      tenantId: auth.tenantId,
      recordId: id,
      userId: auth.sub,
      actionType: body.actionType,
      details: activityDetails
    }).returning()
    const activityLabel: Record<string, string> = { NOTE: 'una nota', EMAIL: 'un correo', CALL: 'una llamada', TASK: 'una tarea' }
    const text = typeof body.details.text === 'string' ? body.details.text.trim() : ''
    const notificationRows = await createNotifications(tx, {
      tenantId: auth.tenantId,
      actorUserId: auth.sub,
      activityId: r.id,
      entitySlug,
      recordId: id,
      actionUrl: `/registros/${entitySlug}/${id}?tab=activity&activityId=${encodeURIComponent(r.id)}`,
      type: mentions.length ? 'MENTION' : 'ACTIVITY',
      title: mentions.length ? `Te mencionaron en ${entity.name}` : `Nueva actividad en ${entity.name}`,
      message: `${entity.name}: ${text || `Se registró ${activityLabel[body.actionType] ?? 'una actividad'}`}`.slice(0, 240),
      recipients: { mentions, userIds: notifyUserIds, roleIds: notifyRoleIds, groupIds: notifyGroupIds }
    })
    return { row: r, notificationRows }
  })

  publishNotifications(result.notificationRows)

  setResponseStatus(event, 201)
  return result.row
})
