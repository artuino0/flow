import { requireAuth } from '~/server/utils/rbac'
import { notificationRecipientOptions } from '~/server/utils/notifications'

// Destinatarios visibles para cualquier usuario autenticado. No expone
// contraseñas ni sustituye el guard de administración para gestionar grupos.
export default defineEventHandler(async event => {
  const auth = requireAuth(event)
  return notificationRecipientOptions(auth.tenantId)
})
