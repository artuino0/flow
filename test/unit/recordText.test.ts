import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveRecordText } from '../../utils/recordText'
afterEach(() => vi.unstubAllGlobals())
describe('texto de actividades', () => {
  it('resuelve relaciones y conserva valores booleanos falsos', async () => {
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
      if (url === '/api/entities/origen/fields') return { fields: [{ name: 'cliente', dataType: 'relation', validationRules: { relationEntity: 'clientes' } }] }
      if (url === '/api/records/origen/1') return { customData: { cliente: '2' } }
      if (url === '/api/entities/clientes/fields') return { fields: [{ name: 'activo', label: 'Activo', dataType: 'boolean' }] }
      return { customData: { activo: false } }
    }))
    expect(await resolveRecordText('Activo: {{cliente.activo}}', 'origen', '1')).toBe('Activo: No')
  })
  it('no guarda una variable incompleta', async () => {
    await expect(resolveRecordText('Hola {{', 'origen', '1')).rejects.toThrow('Completa')
  })
  it('propaga denegaciones de consulta', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('Sin permiso')))
    await expect(resolveRecordText('{{nombre}}', 'origen', '1')).rejects.toThrow('Sin permiso')
  })
})
