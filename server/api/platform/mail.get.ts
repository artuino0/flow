import { requirePlatformAdmin } from '~/server/utils/platformAdmin'
import { platformMailStatus, mailDiagnostics } from '~/server/utils/mailTransport'
export default defineEventHandler(async event => {
  await requirePlatformAdmin(event)
  return { ...await platformMailStatus(), fallbackProvider: process.env.MAIL_FALLBACK_PROVIDER || null, ...mailDiagnostics }
})
