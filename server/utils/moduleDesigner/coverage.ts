import { z } from 'zod'
import type { Blueprint } from '~/server/utils/blueprint/schema'
import { containsUnsafeBlueprintText } from './safety'

export const designerOmissionsSchema = z.array(z.object({
  item: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(360)
}).strict()).max(40).default([])
export type DesignerOmission = z.infer<typeof designerOmissionsSchema>[number]

export function safeDesignerOmissions(omissions: DesignerOmission[]): DesignerOmission[] {
  return omissions.filter(item => !containsUnsafeBlueprintText(item, new Set()))
}

const omissionRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const omissionShape = (value: unknown) => omissionRecord(value) && Object.keys(value).length === 2 && 'item' in value && 'reason' in value

/** Recupera solo metadatos de omisiones; las demás claves siguen llegando al esquema estricto. */
export function extractDesignerOmissions(input: unknown): unknown {
  if (!omissionRecord(input)) return input
  const omissions: DesignerOmission[] = []
  const seen = new Set<string>()
  const collect = (value: unknown) => {
    if (!Array.isArray(value)) return
    for (const entry of value) {
      const parsed = designerOmissionsSchema.removeDefault().element.safeParse(entry)
      if (!parsed.success || containsUnsafeBlueprintText(parsed.data, new Set())) continue
      const key = `${normalizeCoverageName(parsed.data.item)}\n${parsed.data.reason.normalize('NFC').toLowerCase()}`
      if (seen.has(key) || omissions.length >= 40) continue
      seen.add(key)
      omissions.push(parsed.data)
    }
  }
  const clean = (value: unknown): unknown => {
    if (!omissionRecord(value)) return value
    const result: Record<string, unknown> = { ...value }
    for (const [key, entries] of Object.entries(value)) {
      if (key !== 'omissions' && !(Array.isArray(entries) && entries.length > 0 && entries.every(omissionShape))) continue
      collect(entries)
      delete result[key]
    }
    return result
  }
  const answer = clean(input) as Record<string, unknown>
  if (omissionRecord(answer.blueprint)) {
    const blueprint = clean(answer.blueprint) as Record<string, unknown>
    if (Array.isArray(blueprint.modules)) blueprint.modules = blueprint.modules.map(clean)
    answer.blueprint = blueprint
  }
  if (Array.isArray(answer.operations)) {
    answer.operations = answer.operations.flatMap(operation => {
      if (omissionShape(operation)) { collect([operation]); return [] }
      const cleaned = clean(operation)
      if (!omissionRecord(cleaned)) return [cleaned]
      // Un contenedor exclusivo de metadatos no es una operación del parche.
      if (omissionRecord(operation) && Object.keys(operation).length > 0 && Object.keys(cleaned).length === 0) return []
      if ('module' in cleaned) cleaned.module = clean(cleaned.module)
      return [cleaned]
    })
  }
  return { ...answer, omissions }
}

export function normalizeCoverageName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(word => word && !['de', 'del', 'el', 'la', 'los', 'las', 'un', 'una'].includes(word))
    .map(word => word === 'ultima' ? 'ultimo' : word === 'meses' ? 'mes' : word.length > 4 && /[drlznj]es$/.test(word) && !word.endsWith('bles') ? word.slice(0, -2) : word.endsWith('iones') ? word.slice(0, -2) : word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word).join(' ')
}
const matches = (requested: string, actual: string) => {
  const a = normalizeCoverageName(requested).split(' ')
  const b = normalizeCoverageName(actual).split(' ')
  return a.every(word => b.includes(word))
}
type RequestedItem = { item: string; module?: string; kind: 'field' | 'module' | 'catalog'; calculated: boolean }

/** Solo listas explícitas y nombres acotados; no interpreta reglas de negocio ni prosa libre. */
export function designerRequestedItems(instruction: string): RequestedItem[] {
  const items: RequestedItem[] = []
  const lines = instruction.replace(/\r/g, '').replace(/\n[ \t]+/g, ' ').split('\n')
  let section = ''
  const addFields = (text: string, module: string | undefined, calculated: boolean) => {
    for (const part of text.replace(/\([^)]*\)/g, '').split(/,|\s+y\s+/i)) {
      const item = part.trim().replace(/[.;]+$/, '')
      if (item && item.length <= 100 && !containsUnsafeBlueprintText(item, new Set())) items.push({ item, module, kind: 'field', calculated })
    }
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (/\b(?:quita|elimina|borra|retira|no\s+(?:agregues|incluyas|crees))\b/i.test(trimmed)) continue
    if (/^[A-ZÁÉÍÓÚÑÓ ]+$/.test(trimmed) && trimmed) { section = normalizeCoverageName(trimmed); continue }
    const calculated = /\b(calculad[oa]s?|f[oó]rmula|autom[aá]tic[oa]s?)\b/i.test(line)
    const scoped = /^-?\s*En\s+([^:]+):\s*(.+)$/i.exec(trimmed)
    if (scoped && calculated) { addFields(scoped[2]!, scoped[1], true); continue }
    const fieldList = /^-?\s*Campos?\s+(?:calculados?|autom[aá]ticos?|con\s+f[oó]rmula)(?:\s+en\s+([^:]+))?:\s*(.+)$/i.exec(trimmed)
    if (fieldList) { addFields(fieldList[2]!, fieldList[1], true); continue }
    const module = /^\d+[).]\s*([^:]+):\s*(.+)$/.exec(trimmed)
    if (section === 'modulo' && module) {
      items.push({ item: module[1]!.trim(), kind: 'module', calculated: false })
      addFields(module[2]!, module[1]!.trim(), calculated)
    }
    const catalog = /^-\s*([^:.(]+)(?:[:.(]|$)/.exec(trimmed)
    if (section === 'catalogo' && catalog) items.push({ item: catalog[1]!.trim(), kind: 'catalog', calculated: false })
    if (calculated && !scoped) {
      const named = /(?:campo\s+(?:calculado|automático)\s+|campo\s+)?[«“"]([^»”"\n]{1,100})[»”"]/g
      for (const match of line.matchAll(named)) items.push({ item: match[1]!.trim(), kind: 'field', calculated: true })
      const plain = /campo\s+(?:calculado|autom[aá]tico)\s+([\p{L}\d ]{1,100})(?:[.:;]|$)/iu.exec(trimmed)
      if (plain) addFields(plain[1]!, undefined, true)
    }
  }
  return items.filter((item, index) => items.findIndex(other => normalizeCoverageName(other.item) === normalizeCoverageName(item.item) && other.module === item.module && other.kind === item.kind && other.calculated === item.calculated) === index)
}

export function designerCoverageWarnings(instruction: string, blueprint: Blueprint, omissions: DesignerOmission[] = [], existingWarnings: string[] = []): string[] {
  const warnings: string[] = []
  for (const requested of designerRequestedItems(instruction)) {
    if (omissions.some(omission => matches(requested.item, omission.item)) || existingWarnings.some(warning => normalizeCoverageName(warning).includes(normalizeCoverageName(requested.item)))) continue
    const modules = requested.module ? blueprint.modules.filter(module => matches(requested.module!, module.name) || matches(requested.module!, module.slug)) : blueprint.modules
    const fields = modules.flatMap(module => module.fields)
    const field = fields.find(field => matches(requested.item, field.label) || matches(requested.item, field.name))
    const module = blueprint.modules.find(module => matches(requested.item, module.name) || matches(requested.item, module.slug))
    // Un catálogo puede expresarse con opciones o usuarios, sin crear otra entidad.
    const represented = requested.kind === 'field' ? Boolean(field) : Boolean(module) || (requested.kind === 'catalog' && fields.some(field => (matches(requested.item, field.label) || matches(field.label, requested.item)) && ['user', 'select', 'multiselect', 'relation'].includes(field.dataType)))
    if (represented && (!requested.calculated || field?.validationRules?.calculation)) continue
    const type = requested.calculated ? 'campo calculado' : requested.kind === 'field' ? 'campo' : requested.kind === 'catalog' ? 'catálogo' : 'módulo'
    const discrepancy = represented ? 'quedó como campo simple, sin cálculo' : 'no quedó en el plano'
    const warning = `Pediste «${requested.item}» como ${type}${requested.module ? ` en ${requested.module}` : ''}, pero ${discrepancy}; puedes pedírmelo de nuevo.`
    if (!containsUnsafeBlueprintText(warning, new Set())) warnings.push(warning)
  }
  return [...new Set(warnings)]
}

export function designerOmissionWarnings(omissions: DesignerOmission[]): string[] {
  return [...new Set(safeDesignerOmissions(omissions).map(({ item, reason }) => `No quedó completo «${item}»: ${reason}`))]
}
