import { describe, expect, it } from 'vitest'
import { normalizeRegistrationChoice } from '../../utils/registrationIntent'

describe('parámetros de la landing', () => {
  it.each(['agenda', 'starter', 'crecimiento', 'escala', ' STÁRTER '])('normaliza %s', plan => {
    expect(normalizeRegistrationChoice({ plan, interval: ' YEAR ' })).toEqual({ plan: plan.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''), interval: 'year' })
  })
  it('usa mensual por omisión e ignora precios y retornos', () => {
    expect(normalizeRegistrationChoice({ plan: 'starter', price: 1, returnUrl: 'https://evil.test' })).toEqual({ plan: 'starter', interval: 'month' })
  })
  it.each(['empresarial', 'no-existe', '<script>alert(1)</script>', 'starter'.repeat(30), ['starter'], null])('ignora un plan inválido %s', plan => {
    expect(normalizeRegistrationChoice({ plan })).toBeNull()
  })
  it.each(['invalid', '', 'year'.repeat(30), ['year'], null])('ignora un intervalo inválido %s', interval => {
    expect(normalizeRegistrationChoice({ plan: 'starter', interval })).toBeNull()
  })
  it('sanea y limita atribución, sin aceptar correos, URLs o arrays', () => {
    expect(normalizeRegistrationChoice({ plan: 'agenda', utm_source: ' Pá<gina> ', utm_medium: 'a'.repeat(100), utm_campaign: 'alguien@example.test', ref: 'https://evil.test' })).toEqual({ plan: 'agenda', interval: 'month', utm_source: 'Pagina', utm_medium: 'a'.repeat(80) })
    expect(normalizeRegistrationChoice({ plan: 'agenda', ref: ['x'], utm_campaign: 'x'.repeat(300) })).toEqual({ plan: 'agenda', interval: 'month' })
  })
})
