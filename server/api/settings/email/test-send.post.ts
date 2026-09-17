import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { sendPlainEmail } from '~/server/utils/mailer'

const bodySchema = z.object({ to: z.string().trim().email() })

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const { to } = await readValidatedBody(event, bodySchema.parse)
  await sendPlainEmail({
    tenantId: auth.tenantId,
    to,
    subject: 'Correo de prueba · FlowERP',
    html: '<p style="margin:0">La configuración de correo saliente funciona correctamente.</p>'
  })
  return { ok: true }
})

