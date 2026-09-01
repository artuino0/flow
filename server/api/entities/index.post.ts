import { z } from 'zod'
import { requireAdminRole } from '~/server/utils/rbac'
import { createEntity, DuplicateSlugError, SLUG_PATTERN } from '~/server/utils/moduleEntities'
import { MODULE_ICON_KEY_SET } from '~/server/utils/moduleIcons'

// POST /api/entities { name, slug, description?, icon? } (HU-ERD-66; icon:
// pedido directo del usuario 2026-09-01, ver comentario largo en
// server/db/schema.ts) - crea un modulo nuevo. Solo Administrador
// (requireAdminRole, HU-ERD-61) - hasta esta HU, la unica forma de dar de
// alta un modulo era scripts/seed.mjs (HU-ERD-25) o SQL directo.
const bodySchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio'),
  slug: z
    .string()
    .trim()
    .min(1, 'El slug es obligatorio')
    .regex(SLUG_PATTERN, 'El slug solo puede tener minusculas, numeros y guiones (ej. "clientes")'),
  description: z.string().trim().min(1).nullable().optional(),
  // El asistente "Crear módulo" (pages/modulos/nuevo.vue) no pide icono
  // todavia (sin mock propio en el .pen para eso, ver utils/moduleIcons.ts) -
  // se puede elegir despues desde "Editar módulo". Optional/nullable para no
  // romper si en el futuro se agrega ahi tambien.
  //
  // z.string().refine() en vez de z.enum(): con el catalogo completo de
  // @lucide/vue (1781 nombres, ver server/utils/moduleIcons.ts) un union
  // type literal de z.enum seria enorme y lento de chequear en TS - el Set
  // valida exactamente lo mismo en runtime sin ese costo.
  icon: z
    .string()
    .refine((v) => MODULE_ICON_KEY_SET.has(v), { message: 'Icono invalido' })
    .nullable()
    .optional()
})

export default defineEventHandler(async (event) => {
  const auth = await requireAdminRole(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  try {
    const entity = await createEntity(auth.tenantId, {
      name: body.name,
      slug: body.slug,
      description: body.description ?? null,
      icon: body.icon ?? null
    })
    setResponseStatus(event, 201)
    return entity
  } catch (err) {
    if (err instanceof DuplicateSlugError) {
      throw createError({ statusCode: 409, statusMessage: err.message })
    }
    throw err
  }
})
