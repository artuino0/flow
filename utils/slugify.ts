// Auto-importado por Nuxt (directorio utils/). Extraido de
// pages/modulos/nuevo.vue (HU-ERD-70, donde nacio para el slug del modulo)
// para reusarlo tal cual en HU-ERD-71 - "value" autogenerado de las opciones
// de un campo Select/Multiselect y "name" autogenerado de las columnas de un
// campo Tabla siguen exactamente el mismo criterio (minusculas, sin acentos,
// separado por guiones/guion bajo segun el caso).
const DIACRITICS_RE = new RegExp('[̀-ͯ]', 'g')

/** "Nombre Con Ácentos" -> "nombre-con-acentos". Usado para slugs (separador "-"). */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * "Nombre Con Ácentos" -> "nombre_con_acentos". Igual que slugify() pero con
 * "_" - usado para nombres tecnicos que deben matchear ^[a-z][a-z0-9_]*$
 * (nombre de campo/columna, ver server/api/entities/[entity]/fields.post.ts).
 */
export function slugifyIdentifier(value: string): string {
  return slugify(value).replace(/-/g, '_')
}
