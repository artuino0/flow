import { describe, expect, it } from 'vitest'
import { assertWritableRelations } from '../../server/utils/relationWriteGuard'
import type { db } from '../../server/db'

const fields = [
  { name: 'cliente', dataType: 'relation', validationRules: { relationEntity: 'clientes' } },
  { name: 'partidas', dataType: 'tabla', validationRules: { columns: [{ name: 'origen', type: 'relation', relationEntity: 'clientes' }] } }
]

function inactiveTx() {
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ isActive: false, deletedAt: null }] }) }) })
  }
  return tx as unknown as typeof db
}

describe('referencias a módulos deshabilitados', () => {
  it('conserva las referencias históricas sin consultar el destino', async () => {
    const existing = { cliente: 'a', partidas: [{ origen: 'b' }] }
    const tx = { select: () => { throw new Error('No debe consultar el destino') } } as unknown as typeof db
    await expect(assertWritableRelations(tx, 'tenant', fields, existing, existing)).resolves.toBeUndefined()
  })

  it('rechaza una asignación nueva y una fila duplicada en tabla', async () => {
    await expect(assertWritableRelations(inactiveTx(), 'tenant', fields, { cliente: 'nuevo' }))
      .rejects.toThrow('deshabilitado')
    await expect(assertWritableRelations(inactiveTx(), 'tenant', fields,
      { partidas: [{ origen: 'a' }, { origen: 'a' }] }, { partidas: [{ origen: 'a' }] }))
      .rejects.toThrow('deshabilitado')
  })
})
