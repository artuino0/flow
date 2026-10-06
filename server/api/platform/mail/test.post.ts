import { requirePlatformAdmin } from '~/server/utils/platformAdmin'
import { deliverMail } from '~/server/utils/mailTransport'
import { authRequestLimit } from '~/server/utils/authPersistentLimit'
export default defineEventHandler(async event => {
  const { auth, email } = await requirePlatformAdmin(event)
  await authRequestLimit(event, 'mail-test', auth.sub, auth.tenantId)
  try {
    const result = await deliverMail({ to: email, subject: 'Prueba del correo de Flow', html: '<p>La configuración del correo de plataforma funciona.</p>' }, undefined, true)
    return { ok: true, provider: result.provider, durationMs: result.durationMs }
  } catch (error) {
    const { MailError } = await import('~/server/utils/mail/types')
    throw createError({ statusCode: 502, statusMessage: error instanceof MailError ? error.message : 'No se pudo completar el envío de prueba.' })
  }
})
