import { z } from 'zod'
import { getAppMode } from '~/server/utils/appConfig'
import { TENANT_SLUG_PATTERN, isSlugAvailable } from '~/server/utils/registration'

// GET /api/tenants/check-slug?slug=acme (HU multi-organizacion, 2026-09-04):
// Paso 2 del wizard de Registro ("Disponible — tu equipo entrará por
// acme.erpdinamico.com" del .pen) - publico (no hay sesion todavia), no
// filtra nada sensible (solo si un slug ya esta tomado).
const querySchema = z.object({ slug: z.string().trim().toLowerCase() })

export default defineEventHandler(async (event) => {
  if (getAppMode() === 'dedicated') {
    throw createError({ statusCode: 403, statusMessage: 'Este deployment no acepta registro de nuevas organizaciones' })
  }

  const query = await getValidatedQuery(event, querySchema.parse)

  if (!TENANT_SLUG_PATTERN.test(query.slug)) {
    return { available: false, reason: 'formato' }
  }

  const available = await isSlugAvailable(query.slug)
  return { available }
})
