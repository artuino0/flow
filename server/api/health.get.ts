import { platformMailStatus } from '~/server/utils/mailTransport'
export default defineEventHandler(async () => {
  return {
    status: 'ok',
    mail: (await platformMailStatus()).status,
    service: 'erp-dinamico-frontback',
    timestamp: new Date().toISOString()
  }
})
