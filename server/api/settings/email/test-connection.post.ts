import { createTransporter, resolveSmtpConfig } from '~/server/utils/mailer'
import { requireAdminRole } from '~/server/utils/rbac'

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const smtp = await resolveSmtpConfig(auth.tenantId)
  const transporter = createTransporter(smtp)
  await transporter.verify()
  return { ok: true, source: 'database' }
})

