import { platformMailStatus } from '~/server/utils/mailTransport'
import { logger } from '~/server/utils/logger'
export default defineNitroPlugin(async () => {
  const status = await platformMailStatus()
  if (status.status !== 'ok') logger.warn('mail_misconfigured', { provider: status.provider, reason: status.reason })
})
