import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { users } from '~/server/db/schema'
import { verifyPassword, signAuthToken } from '~/server/utils/auth'

// MVP: el cliente indica el tenant explicitamente (tenantId). Cuando exista
// resolucion por subdominio/dominio (multi-tenant SaaS), este endpoint debe
// resolver el tenant a partir del host en vez de confiar en el body.
const bodySchema = z.object({
  tenantId: z.string().uuid(),
  email: z.string().email(),
  password: z.string().min(1)
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, bodySchema.parse)
  const config = useRuntimeConfig()

  const user = await withTenant(body.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(users)
      .where(and(eq(users.tenantId, body.tenantId), eq(users.email, body.email)))
      .limit(1)
    return rows[0] ?? null
  })

  if (!user || !user.isActive) {
    throw createError({ statusCode: 401, statusMessage: 'Credenciales invalidas' })
  }

  const valid = await verifyPassword(body.password, user.passwordHash)
  if (!valid) {
    throw createError({ statusCode: 401, statusMessage: 'Credenciales invalidas' })
  }

  const token = signAuthToken(
    { sub: user.id, tenantId: user.tenantId, roleId: user.roleId },
    config.jwtSecret as string
  )

  return { token }
})
