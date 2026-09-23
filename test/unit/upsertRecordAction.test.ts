import { describe, expect, it } from 'vitest'
import { upsertRecordConfigSchema } from '../../server/utils/triggerActions'

describe('upsertRecordConfigSchema', () => {
  it('accepts mappings, duplicate matching and an optional relation', () => {
    const parsed = upsertRecordConfigSchema.parse({
      targetEntityId: '63b85c65-c3cc-4a61-9e08-06f14d2aa224',
      mappings: [
        { sourceField: 'nombre_completo', targetField: 'nombre' },
        { sourceField: 'correo', targetField: 'email' }
      ],
      values: { estado: 'activo' },
      matchBy: [{ sourceField: 'correo', targetField: 'email' }],
      existingBehavior: 'update_and_link',
      relationDefinitionId: 'a8a9472a-d0b8-49c0-8123-5b80f10383f7'
    })
    expect(parsed.matchBy).toHaveLength(1)
    expect(parsed.values).toEqual({ estado: 'activo' })
  })

  it('rejects a conversion without field mappings', () => {
    expect(upsertRecordConfigSchema.safeParse({
      targetEntityId: '63b85c65-c3cc-4a61-9e08-06f14d2aa224',
      mappings: []
    }).success).toBe(false)
  })
})
