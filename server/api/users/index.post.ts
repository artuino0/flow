import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireAdminRole } from '~/server/utils/rbac'
import { withTenant } from '~/server/db'
import { users } from '~/server/db/schema'
import { DuplicateEmailError, RoleNotFoundError, inviteUser } from '~/server/utils/users'
import { SmtpNotConfiguredError } from '~/server/utils/mailer'

// POST /api/users { email, roleId } - modal "Invitar usuario" del diseño
// real (Screen/Usuarios: campos Correo electrónico + Rol, botón "Enviar
// invitación"). Manda un correo real via SMTP (server/utils/mailer.ts) - la
// plataforma no tenia esta capacidad hasta esta HU (usuario eligio "SMTP
// real ahora" sobre un enlace manual, 2026-09-02).
const bodySchema = z.object({
  email: z.string().trim().email('Correo inválido'),
  roleId: z.string().uuid('Selecciona un rol')
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  // Nombre de quien invita, para el cuerpo del correo ("<Nombre> te invitó a
  // colaborar...", copy exacto del .pen) - cae al correo si el admin todavia
  // no cargo su nombre completo (mismo fallback que layouts/default.vue usa
  // para el avatar/header).
  const inviter = await withTenant(auth.tenantId, async (tx) => {
    const [row] = await tx.select({ email: users.email, fullName: users.fullName }).from(users).where(eq(users.id, auth.sub)).limit(1)
    return row ?? null
  })
  const inviterName = inviter?.fullName?.trim() || inviter?.email || 'Un administrador'

  try {
    const result = await inviteUser(auth.tenantId, body.email, body.roleId, inviterName)
    setResponseStatus(event, 201)
    return result
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      throw createError({ statusCode: 409, statusMessage: err.message })
    }
    if (err instanceof RoleNotFoundError) {
      throw createError({ statusCode: 404, statusMessage: err.message })
    }
    if (err instanceof SmtpNotConfiguredError) {
      throw createError({ statusCode: 500, statusMessage: err.message })
    }
    throw err
  }
})
