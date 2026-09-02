import { describe, it, expect } from 'vitest'
import { interpolateTemplate } from '../../server/utils/triggerActions'

// HU-ERD-50: cubre interpolateTemplate() (puro, sin Postgres ni SMTP) - la
// plantilla de la accion "email" de un trigger.

describe('interpolateTemplate', () => {
  it('reemplaza {{campo}} por el valor del record', () => {
    expect(interpolateTemplate('Hola {{nombre}}', { nombre: 'Ana' })).toBe('Hola Ana')
  })

  it('reemplaza multiples ocurrencias, incluso el mismo campo repetido', () => {
    expect(interpolateTemplate('{{estado}} - {{estado}}', { estado: 'nuevo' })).toBe('nuevo - nuevo')
  })

  it('un campo ausente en el record se interpola como cadena vacia (no revienta la plantilla)', () => {
    expect(interpolateTemplate('Valor: {{inexistente}}', {})).toBe('Valor: ')
  })

  it('un campo con value null se interpola como cadena vacia', () => {
    expect(interpolateTemplate('Valor: {{campo}}', { campo: null })).toBe('Valor: ')
  })

  it('un numero o booleano se interpola como su representacion en texto', () => {
    expect(interpolateTemplate('Monto: {{monto}}', { monto: 1500 })).toBe('Monto: 1500')
    expect(interpolateTemplate('Activo: {{activo}}', { activo: true })).toBe('Activo: true')
  })

  it('escapa HTML en el valor interpolado - nunca inyecta markup/codigo del record en el correo', () => {
    expect(interpolateTemplate('Nombre: {{nombre}}', { nombre: '<script>alert(1)</script>' })).toBe(
      'Nombre: &lt;script&gt;alert(1)&lt;/script&gt;'
    )
  })

  it('el texto fuera de {{...}} queda intacto, sin espacios raros dentro de las llaves', () => {
    expect(interpolateTemplate('Hola {{ nombre }}, tu pedido {{id}} esta listo.', { nombre: 'Luis', id: 'ABC-1' })).toBe(
      'Hola Luis, tu pedido ABC-1 esta listo.'
    )
  })

  it('un array se interpola como su JSON (no [object Object])', () => {
    expect(interpolateTemplate('Etiquetas: {{etiquetas}}', { etiquetas: ['a', 'b'] })).toBe('Etiquetas: ["a","b"]')
  })
})
