import { describe, it, expect } from 'vitest'
import { pluralize } from '../../server/utils/pluralize'

// Pedido directo del usuario (2026-09-05): "queria que con js en el menu se
// pusiera en plural, no queria un campo nuevo" - ver comentario largo en
// server/utils/pluralize.ts para las reglas cubiertas y la limitacion
// conocida (documentada tambien en el ultimo caso de abajo).

describe('pluralize', () => {
  it('vocal atona -> suma "s" (casos tipicos de modulos ERP)', () => {
    expect(pluralize('Empaque')).toBe('Empaques')
    expect(pluralize('Embarque')).toBe('Embarques')
    expect(pluralize('Manifiesto')).toBe('Manifiestos')
    expect(pluralize('Cliente')).toBe('Clientes')
    expect(pluralize('Pedido')).toBe('Pedidos')
    expect(pluralize('Factura')).toBe('Facturas')
  })

  it('"-on/-an/-en/-in/-un" con acento -> pierde el acento y suma "es"', () => {
    expect(pluralize('Recepción')).toBe('Recepciones')
    expect(pluralize('Cotización')).toBe('Cotizaciones')
    expect(pluralize('Razón')).toBe('Razones')
    expect(pluralize('Jardín')).toBe('Jardines')
  })

  it('"-z" -> "-ces"', () => {
    expect(pluralize('Lápiz')).toBe('Lápices')
    expect(pluralize('Luz')).toBe('Luces')
  })

  it('consonante (no "z") -> suma "es"', () => {
    expect(pluralize('Actividad')).toBe('Actividades')
    expect(pluralize('Papel')).toBe('Papeles')
  })

  it('ya termina en "s" sobre vocal atona -> no cambia (idempotente)', () => {
    expect(pluralize('Lunes')).toBe('Lunes')
    expect(pluralize('Empaques')).toBe('Empaques')
  })

  it('multi-palabra: pluraliza solo la primera ("Nombre de Nombre")', () => {
    expect(pluralize('Orden de Compra')).toBe('Ordenes de Compra')
    expect(pluralize('Factura de Venta')).toBe('Facturas de Venta')
  })

  it('vacio o solo espacios devuelve vacio', () => {
    expect(pluralize('')).toBe('')
    expect(pluralize('   ')).toBe('')
  })

  it('limitacion conocida y documentada: no reacentua "-en" que cambia de acentuacion al pluralizar', () => {
    // El plural correcto de "Orden" es "Órdenes" (gana un acento nuevo) -
    // esta funcion no detecta ese cambio de acentuacion (requeriria un
    // algoritmo de silabas/acentuacion completo, fuera de alcance de este
    // pedido puntual) y devuelve "Ordenes" sin el acento. Test que fija el
    // comportamiento actual a proposito, no un bug pendiente de arreglar.
    expect(pluralize('Orden')).toBe('Ordenes')
  })
})
