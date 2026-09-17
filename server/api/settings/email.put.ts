import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { withTenant } from '~/server/db'
import { tenantEmailSettings } from '~/server/db/schema'
import { encryptSetting } from '~/server/utils/settingsCrypto'
import { requireAdminRole } from '~/server/utils/rbac'

const bodySchema = z.object({
  provider: z.literal('smtp').default('smtp'),
  host: z.string().trim().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  security: z.enum(['tls', 'ssl', 'none']).default('tls'),
  username: z.string().trim().min(1),
  password: z.string().optional(),
  fromEmail: z.string().trim().email(),
  fromName: z.string().trim().max(120).optional().default('FlowERP'),
  replyTo: z.string().trim().email().optional().or(z.literal('')).default('')
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, bodySchema.parse)
  await withTenant(auth.tenantId, async (tx) => {
    const [existing] = await tx.select().from(tenantEmailSettings).where(eq(tenantEmailSettings.tenantId, auth.tenantId)).limit(1)
    const values = {
      tenantId: auth.tenantId,
      provider: body.provider,
      host: body.host,
      port: body.port,
      security: body.security,
      username: body.username,
      passwordEncrypted: body.password ? encryptSetting(body.password) : existing?.passwordEncrypted ?? null,
      fromEmail: body.fromEmail,
      fromName: body.fromName || null,
      replyTo: body.replyTo || null,
      createdBy: existing?.createdBy ?? auth.sub,
      updatedAt: new Date()
    }
    if (!existing && !values.passwordEncrypted) throw createError({ statusCode: 400, statusMessage: 'La contraseña SMTP es requerida' })
    if (existing) {
      await tx.update(tenantEmailSettings).set(values).where(and(eq(tenantEmailSettings.id, existing.id), eq(tenantEmailSettings.tenantId, auth.tenantId)))
    } else {
      await tx.insert(tenantEmailSettings).values(values)
    }
  })
  return { ok: true }
})
