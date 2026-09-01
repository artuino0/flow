import { requireAuth } from '~/server/utils/rbac'
import { listVisibleEntities } from '~/server/utils/moduleEntities'

// GET /api/nav/entities (ERD-43/ERD-44): entidades visibles para armar el
// menu dinamico (components/AppNav.vue) - a diferencia de GET /api/entities
// (admin-only, la pantalla de administracion de modulos, HU-ERD-66/69), este
// endpoint es para CUALQUIER usuario autenticado (requireAuth) y devuelve
// solo lo que su rol puede leer.
//
// Ruta separada bajo /api/nav/ (no /api/entities/nav) a proposito, para que
// nunca quede al lado de la ruta dinamica /api/entities/:entity/fields.get.ts
// bajo el mismo prefijo - mismo criterio de evitar el bug de tipado
// Nitro/rou3 (interseccion de metodos en $fetch tipado) ya documentado en
// server/api/entity-fields/reorder.put.ts.
//
// requireAuth() ya lanza 403 si el usuario no tiene rol asignado (en vez de
// devolver lista vacia como sugiere el texto original de ERD-43) - se
// mantiene consistente con como se comporta CUALQUIER otro endpoint
// autenticado de esta app (dashboard, roles, etc.), no una excepcion sola
// para este caso.
export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const entities = await listVisibleEntities(auth.tenantId, auth.roleId!)
  return { entities }
})
