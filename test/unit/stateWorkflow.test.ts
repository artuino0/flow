import { describe, expect, it } from 'vitest'
import { stateWorkflowSchema } from '../../server/utils/stateWorkflow'

const valid = {
  enabled: true,
  field: 'estado',
  initial: 'borrador',
  states: {
    borrador: { locked: false, editableFields: [] },
    pagado: { locked: true, editableFields: ['nota'] }
  },
  transitions: [
    { from: 'borrador', to: 'pagado', roles: ['role-admin'] },
    { from: 'pagado', to: 'borrador', roles: ['role-admin'], label: 'Reabrir' }
  ],
  rules: []
}

describe('stateWorkflowSchema', () => {
  it('acepta un flujo con estados, transición de reapertura y excepciones', () => {
    expect(stateWorkflowSchema.safeParse(valid).success).toBe(true)
  })

  it('conserva la compatibilidad sin layout y acepta posiciones opcionales', () => {
    expect(stateWorkflowSchema.safeParse({ ...valid, layout: { borrador: { x: 12, y: 24 } } }).success).toBe(true)
    expect(stateWorkflowSchema.safeParse({ ...valid, layout: { borrador: { x: '12', y: 24 } } }).success).toBe(false)
  })

  it('rechaza un estado inicial inexistente', () => {
    expect(stateWorkflowSchema.safeParse({ ...valid, initial: 'desconocido' }).success).toBe(false)
  })

  it('rechaza transiciones que apuntan a estados no configurados', () => {
    expect(stateWorkflowSchema.safeParse({ ...valid, transitions: [{ from: 'borrador', to: 'cancelado', roles: 'all' }] }).success).toBe(false)
  })

  it('rechaza campos exceptuados en estados no bloqueantes', () => {
    expect(stateWorkflowSchema.safeParse({ ...valid, states: { ...valid.states, borrador: { locked: false, editableFields: ['nota'] } } }).success).toBe(false)
  })

  it('acepta las tres formas de regla con modo y destino', () => {
    const rules = [
      { type: 'required', mode: 'block', when: { to: 'pagado' }, fields: ['referencia'], message: 'Falta referencia' },
      { type: 'lineCompare', mode: 'warn', when: { from: 'borrador', to: 'pagado' }, lineEntity: 'partidas', relationField: 'pedido', valueField: 'cantidad', relatedField: 'producto', compareField: 'disponible', operator: '<=', message: 'Excede inventario' },
      { type: 'aggregate', mode: 'block', when: { to: 'pagado' }, lineEntity: 'partidas', relationField: 'pedido', aggregate: 'count', operator: '>', value: 0, message: 'Agrega partidas' }
    ]
    expect(stateWorkflowSchema.safeParse({ ...valid, rules }).success).toBe(true)
  })

  it('rechaza reglas con operadores o modos no permitidos', () => {
    const rule = { type: 'aggregate', mode: 'ignore', when: { to: 'pagado' }, relationField: 'pedido', aggregate: 'count', operator: '!=', value: 0, message: 'Agrega partidas' }
    expect(stateWorkflowSchema.safeParse({ ...valid, rules: [rule] }).success).toBe(false)
  })
})
