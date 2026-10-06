import { z } from 'zod'
import { getAppMode } from '~/server/utils/appConfig'
import { issueSessionCookies } from '~/server/utils/auth'
import { TENANT_SLUG_PATTERN } from '~/server/utils/registration'
import { completeProvisionalRegistration, witnessCookie, publicRegistrationOperation } from '~/server/utils/provisionalRegistration'
import { authRequestLimit } from '~/server/utils/authPersistentLimit'

const bodySchema = z.object({
  organizationName: z.string().trim().min(1, 'Ingresa el nombre de tu organización').max(200),
  slug: z.string().trim().toLowerCase().regex(TENANT_SLUG_PATTERN, 'El identificador solo puede tener letras, números y guiones'),
  invitees: z.array(z.object({ email: z.string().trim().toLowerCase().email() })).max(20).optional()
}).strict()

export default defineEventHandler(async (event) => {
  if (getAppMode() === 'dedicated') throw createError({ statusCode: 403, statusMessage: 'Este deployment no acepta registro de nuevas organizaciones' })
  const body = await readValidatedBody(event, bodySchema.parse)
  await authRequestLimit(event, 'registration-complete')
  const result = await publicRegistrationOperation(() => completeProvisionalRegistration(witnessCookie(event), body))
  const config = useRuntimeConfig()
  await issueSessionCookies(event, { sub: result.userId, tenantId: result.tenantId, roleId: result.adminRoleId }, config.jwtSecret as string)
  return { ok: true, tenantId: result.tenantId, tenantName: result.tenantName, slug: result.slug,
    invitationsSent: result.invitationsQueued, invitationsQueued: result.invitationsQueued, invitationsFailed: result.invitationsFailed,
    resumed: Boolean(result.resumed) }
})
