import { z } from 'zod'
import { getAppMode } from '~/server/utils/appConfig'
import { passwordPolicySchema } from '~/server/utils/passwordPolicy'
import { issueSessionCookies } from '~/server/utils/auth'
import { RegistrationEmailExistsError, SlugTakenError, TENANT_SLUG_PATTERN, registerTenant } from '~/server/utils/registration'
import { DuplicateEmailError, RoleNotFoundError, inviteUser } from '~/server/utils/users'
import { SmtpNotConfiguredError, escapeHtml, sendPlainEmail } from '~/server/utils/mailer'

// POST /api/auth/register (HU multi-organizacion, 2026-09-04): "Registro"
// (Screen/Registro Paso 1-4 del .pen) - crea la persona + su primera
// organización en una sola llamada (el wizard de 4 pasos del frontend junta
// todo antes de mandarlo, no hay estado a medio armar en el servidor entre
// pasos). SOLO en modo "saas" - un deployment "dedicated" (un solo cliente
// por definicion, HU-ERD-35) no tiene sentido que deje crear organizaciones
// nuevas.
const bodySchema = z.object({
  fullName: z.string().trim().min(1, 'Ingresa tu nombre completo'),
  email: z.string().trim().email('Correo inválido'),
  password: passwordPolicySchema,
  organizationName: z.string().trim().min(1, 'Ingresa el nombre de tu organización'),
  slug: z.string().trim().toLowerCase().regex(TENANT_SLUG_PATTERN, 'El subdominio solo puede tener letras, números y guiones'),
  // Paso 3 "Invitá a tu equipo" - opcional, "Omitir por ahora" en el diseño.
  invitees: z.array(z.object({ email: z.string().trim().email() })).max(20).optional()
})

export default defineEventHandler(async (event) => {
  if (getAppMode() === 'dedicated') {
    throw createError({ statusCode: 403, statusMessage: 'Este deployment no acepta registro de nuevas organizaciones' })
  }

  const body = await readValidatedBody(event, bodySchema.parse)

  let result
  try {
    result = await registerTenant(body)
  } catch (err) {
    if (err instanceof RegistrationEmailExistsError) {
      throw createError({ statusCode: 409, statusMessage: err.message })
    }
    if (err instanceof SlugTakenError) {
      throw createError({ statusCode: 409, statusMessage: err.message })
    }
    throw err
  }

  // Paso 3: invitaciones opcionales - best-effort, cada una independiente
  // (si una falla - ej. correo repetido en la lista - las demas y la
  // organización recien creada NO se pierden). Reusa inviteUser() tal cual
  // (server/utils/users.ts) con el rol "Miembro" creado en registerTenant().
  const invitationResults: { email: string; ok: boolean }[] = []
  for (const invitee of body.invitees ?? []) {
    try {
      await inviteUser(result.tenantId, invitee.email, result.memberRoleId, body.fullName)
      invitationResults.push({ email: invitee.email, ok: true })
    } catch (err) {
      if (err instanceof DuplicateEmailError || err instanceof RoleNotFoundError || err instanceof SmtpNotConfiguredError) {
        invitationResults.push({ email: invitee.email, ok: false })
        continue
      }
      throw err
    }
  }

  // Paso 4 "Todo listo": "Te enviamos un correo de confirmación a..." del
  // diseño - best-effort (nunca bloquea el registro, ya completado).
  try {
    await sendPlainEmail({
      to: body.email,
      subject: `Tu organización ${body.organizationName} está lista en FlowERP`,
      html: `<p>Hola ${escapeHtml(body.fullName)}, tu organización <strong>${escapeHtml(body.organizationName)}</strong> ya está lista. Ingresá con tu correo y contraseña cuando quieras.</p>`
    })
  } catch {
    // best-effort, ver comentario
  }

  // La persona que se registra queda como Administrador de su organización
  // recien creada (rol asignado en registerTenant()) - inicia sesion de una,
  // sin volver a pedir contraseña (mismo criterio que cualquier alta que
  // termina logueada, ej. aceptar invitación NO hace esto porque ahi la
  // organización no es "propia" del invitado en el mismo sentido).
  const config = useRuntimeConfig()
  issueSessionCookies(event, { sub: result.userId, tenantId: result.tenantId, roleId: result.adminRoleId }, config.jwtSecret as string)

  return {
    ok: true,
    tenantId: result.tenantId,
    tenantName: result.tenantName,
    slug: result.slug,
    invitationsSent: invitationResults.filter((r) => r.ok).length
  }
})
