import type { EntityFieldMeta } from '~/composables/useEntityFields'

export async function resolveRecordText(text: string, entity: string, recordId: string): Promise<string> {
  const tokens = [...text.matchAll(/\{\{\s*([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+){0,3})\s*\}\}/g)]
  let result = text
  for (const token of tokens) {
    let slug = entity; let id = recordId; let value: unknown
    const parts = token[1]!.split('.')
    for (let i = 0; i < parts.length; i++) {
      const [meta, record] = await Promise.all([
        $fetch<{ fields: EntityFieldMeta[] }>(`/api/entities/${slug}/fields`),
        $fetch<{ customData: Record<string, unknown> }>(`/api/records/${slug}/${id}`)
      ])
      const field = meta.fields.find(f => f.name === parts[i])
      if (!field) throw new Error(`El campo ${parts[i]} ya no está disponible.`)
      value = record.customData[field.name]
      if (value == null || value === '') throw new Error(`El campo ${field.label} está vacío.`)
      if (i < parts.length - 1) {
        const target = field.validationRules?.relationEntity
        if (field.dataType !== 'relation' || typeof target !== 'string' || typeof value !== 'string') throw new Error('La variable contiene una relación inválida.')
        slug = target; id = value
      }
    }
    result = result.replace(token[0], typeof value === 'boolean' ? value ? 'Sí' : 'No' : String(value))
  }
  if (result.includes('{{') || result.includes('}}')) throw new Error('Completa o elimina las variables pendientes antes de guardar.')
  return result
}
