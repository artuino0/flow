import { and, eq, sql as dsql } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { entities, entityFields, records } from '~/server/db/schema'
import { getEntityZodSchema } from './dynamicSchema'
import { recordNotDeleted } from './records'

// HU-ERD-80: importacion masiva de datos (CSV) por entidad - pedido explicito
// del usuario tras la revision de gaps de plataforma (2026-09-01, ver
// ERD-77/78/80/83, priorizado primero de los 4). El CSV se parsea COMPLETO
// en el navegador (papaparse, ver pages/registros/[entity]/importar.vue) y
// las filas ya parseadas se mandan como JSON - se evita necesitar manejo de
// multipart/form-data en el servidor (esa es infraestructura nueva,
// reservada para ERD-78 que si la necesita de verdad para archivos
// binarios; un CSV es texto plano, no hace falta).
//
// Reglas de esta HU:
// - Cada fila se valida con el MISMO schema Zod dinamico que ya usa
//   POST /api/records/:entity (getEntityZodSchema, ERD-17) - ninguna regla
//   de validacion se duplica ni se reinventa.
// - Una columna que corresponde a un campo 'relation' llega como TEXTO (la
//   etiqueta legible del registro relacionado, ej. "Rancho El Aguacate"), no
//   como uuid - un usuario armando un CSV a mano no tiene forma de conocer
//   uuids. Se resuelve buscando, dentro de la entidad relacionada, un record
//   cuyo "campo etiqueta" (primer campo de tipo text - MISMO criterio que
//   utils/recordLabel.ts del lado del cliente, DUPLICADO aca a proposito:
//   ese archivo es frontend con un import type de un composable, este es
//   Nitro - mismo criterio ya establecido entre MODULE_ICON_KEYS del backend
//   y MODULE_ICONS del frontend en moduleIcons.ts, nunca importar codigo de
//   utils/ del cliente desde server/) coincida EXACTO, sin distinguir
//   mayusculas/minusculas. Cero coincidencias o mas de una son error de esa
//   fila puntual, nunca una adivinanza silenciosa.
// - Import PARCIAL, a proposito: a diferencia del resto del proyecto
//   ("validar antes de mutar", nunca dejar una operacion a medias - ver
//   createRole() con copyFromRoleId), un importador masivo SI inserta las
//   filas validas y reporta las invalidas aparte. No es una excepcion a ese
//   criterio: aplica a UNA operacion logica (crear un rol con sus permisos
//   copiados es una sola unidad), no a un lote de cientos de filas
//   independientes entre si - bloquear las 499 buenas por 1 mala seria peor
//   UX que cualquier importador real.

export interface ImportRowError {
  row: number
  error: string
}

export interface ImportResult {
  insertedCount: number
  errors: ImportRowError[]
}

export class TooManyImportRowsError extends Error {}

const MAX_IMPORT_ROWS = 2000

interface ImportFieldRow {
  name: string
  dataType: string
  validationRules: unknown
}

// Bug reportado por el usuario (2026-09-04): esta heuristica solo miraba
// dataType 'text', dejando afuera 'incremental' (folio/numero autogenerado -
// justo el tipo de campo que alguien tipearia para buscar "por nombre" al
// importar) - mismo fix que utils/recordLabel.ts y server/utils/relationLabels.ts.
const LABEL_CANDIDATE_TYPES = new Set(['text', 'incremental'])

/** Primer campo de tipo text/incremental de una entidad - misma heuristica de "etiqueta" que utils/recordLabel.ts (frontend), duplicada aca (ver comentario largo arriba). */
function labelFieldFor(fields: ImportFieldRow[]): string | null {
  return fields.find((f) => LABEL_CANDIDATE_TYPES.has(f.dataType))?.name ?? null
}

type RelationLookup = string | { ambiguous: true } | null

/**
 * Importa records en bloque para una entidad, resolviendo columnas
 * relation por texto y validando cada fila con el schema Zod dinamico real.
 * `rows` ya viene parseado (header:true de papaparse en el cliente) - cada
 * fila es un objeto { nombreColumna: valorTexto }.
 */
export async function importRecords(tenantId: string, entityId: string, rows: Array<Record<string, string>>): Promise<ImportResult> {
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new TooManyImportRowsError(`Maximo ${MAX_IMPORT_ROWS} filas por importacion (esta trae ${rows.length})`)
  }

  return withTenant(tenantId, async (tx) => {
    const fieldRows = (await tx
      .select({ name: entityFields.name, dataType: entityFields.dataType, validationRules: entityFields.validationRules })
      .from(entityFields)
      .where(eq(entityFields.entityId, entityId))) as ImportFieldRow[]

    const relationFields = fieldRows.filter((f) => f.dataType === 'relation')
    const relationCache = new Map<string, RelationLookup>()

    async function resolveRelation(relationEntitySlug: string, rawText: string): Promise<string | { error: string }> {
      const trimmed = rawText.trim()
      const key = `${relationEntitySlug}:${trimmed.toLowerCase()}`
      if (relationCache.has(key)) {
        const cached = relationCache.get(key) as RelationLookup
        if (cached === null) return { error: `no se encontro "${trimmed}" en ${relationEntitySlug}` }
        if (typeof cached === 'object') return { error: `"${trimmed}" coincide con mas de un registro en ${relationEntitySlug} - usa un valor mas especifico` }
        return cached
      }

      const [targetEntity] = await tx
        .select({ id: entities.id })
        .from(entities)
        .where(and(eq(entities.tenantId, tenantId), eq(entities.slug, relationEntitySlug)))
        .limit(1)
      if (!targetEntity) {
        relationCache.set(key, null)
        return { error: `la entidad relacionada "${relationEntitySlug}" no existe` }
      }

      const targetFields = (await tx
        .select({ name: entityFields.name, dataType: entityFields.dataType, validationRules: entityFields.validationRules })
        .from(entityFields)
        .where(eq(entityFields.entityId, targetEntity.id))) as ImportFieldRow[]
      const labelField = labelFieldFor(targetFields)
      if (!labelField) {
        relationCache.set(key, null)
        return { error: `${relationEntitySlug} no tiene un campo de texto para buscar "${trimmed}" por nombre` }
      }

      // ERD-87: importar una relacion por nombre solo puede resolver contra
      // registros activos - enlazar una fila nueva a algo que esta en la
      // papelera no tiene sentido para el usuario que esta importando.
      const matches = await tx
        .select({ id: records.id })
        .from(records)
        .where(
          and(
            eq(records.tenantId, tenantId),
            eq(records.entityId, targetEntity.id),
            recordNotDeleted,
            dsql`lower(${records.customData}->>${labelField}) = lower(${trimmed})`
          )
        )
        .limit(2)

      if (matches.length === 0) {
        relationCache.set(key, null)
        return { error: `no se encontro "${trimmed}" en ${relationEntitySlug}` }
      }
      if (matches.length > 1) {
        relationCache.set(key, { ambiguous: true })
        return { error: `"${trimmed}" coincide con mas de un registro en ${relationEntitySlug} - usa un valor mas especifico` }
      }
      relationCache.set(key, matches[0].id)
      return matches[0].id
    }

    const schema = await getEntityZodSchema(tenantId, entityId)
    const toInsert: Record<string, unknown>[] = []
    const errors: ImportRowError[] = []

    for (let i = 0; i < rows.length; i++) {
      const rawRow = rows[i]
      const rowNumber = i + 2 // fila 1 del CSV es el encabezado
      const resolvedRow: Record<string, unknown> = { ...rawRow }
      let rowFailed = false

      for (const field of relationFields) {
        const raw = rawRow[field.name]
        if (raw === undefined || raw === null || raw.trim() === '') continue // vacio: lo resuelve isRequired del schema Zod, no aca
        const rules = (field.validationRules ?? {}) as Record<string, unknown>
        const relationEntitySlug = typeof rules.relationEntity === 'string' ? rules.relationEntity : null
        if (!relationEntitySlug) {
          errors.push({ row: rowNumber, error: `"${field.name}" no tiene entidad relacionada configurada, no se puede importar por texto` })
          rowFailed = true
          continue
        }
        const resolved = await resolveRelation(relationEntitySlug, raw)
        if (typeof resolved === 'object') {
          errors.push({ row: rowNumber, error: `${field.name}: ${resolved.error}` })
          rowFailed = true
        } else {
          resolvedRow[field.name] = resolved
        }
      }

      if (rowFailed) continue

      // El CSV solo trae texto - coerciona antes de pasar por el schema Zod
      // (que espera number/boolean/array reales, no strings). 'relation' ya
      // quedo resuelto a un uuid arriba (sigue siendo string, no le toca
      // ninguna rama de aca abajo salvo la de "vacio" si nunca se resolvio).
      for (const field of fieldRows) {
        const value = resolvedRow[field.name]
        if (typeof value !== 'string') continue
        const trimmed = value.trim()
        if (field.dataType === 'multiselect') {
          resolvedRow[field.name] = trimmed ? trimmed.split(',').map((s) => s.trim()).filter(Boolean) : []
        } else if (field.dataType === 'number') {
          if (trimmed === '') resolvedRow[field.name] = undefined
          else {
            const n = Number(trimmed)
            resolvedRow[field.name] = Number.isNaN(n) ? trimmed : n
          }
        } else if (field.dataType === 'currency') {
          resolvedRow[field.name] = trimmed === '' ? undefined : trimmed.replace(/[$,\s]/g, '')
        } else if (field.dataType === 'boolean') {
          resolvedRow[field.name] = ['true', '1', 'si', 'sí', 'x'].includes(trimmed.toLowerCase())
        } else if (trimmed === '') {
          resolvedRow[field.name] = undefined
        }
      }

      const parsed = schema.safeParse(resolvedRow)
      if (!parsed.success) {
        errors.push({ row: rowNumber, error: parsed.error.issues.map((issue) => issue.message).join('; ') })
        continue
      }
      toInsert.push(parsed.data as Record<string, unknown>)
    }

    if (toInsert.length > 0) {
      await tx.insert(records).values(toInsert.map((customData) => ({ entityId, tenantId, customData })))
    }

    return { insertedCount: toInsert.length, errors }
  })
}
