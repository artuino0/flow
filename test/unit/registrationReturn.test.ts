import { describe, expect, it } from 'vitest'
import { canResendVerification } from '../../server/utils/emailVerification'
import { postLoginRoute, safeInternalRoute } from '../../utils/returnToRoute'

describe('regreso tras inactividad', () => {
  const identity = { id: 'usuario-1', tenantId: 'org-1' }
  const saved = { path: '/modulos/citas?filtro=hoy', userId: identity.id, tenantId: identity.tenantId }

  it('conserva fullPath y solo vuelve para la misma identidad', () => {
    expect(postLoginRoute(saved.path, saved, identity, true)).toBe(saved.path)
    expect(postLoginRoute(undefined, saved, identity, true)).toBe(saved.path)
    expect(postLoginRoute(saved.path, saved, { ...identity, id: 'otro' }, true)).toBe('/')
    expect(postLoginRoute(saved.path, saved, { ...identity, tenantId: 'otra' }, true)).toBe('/')
    expect(postLoginRoute('/modulos/otra', saved, identity, true)).toBe('/')
  })

  it.each(['https://otro.test', '//otro.test', '/\\otro.test', '/login', '/login/otra', '/registro', '/logout'])('rechaza %s', path => {
    expect(safeInternalRoute(path)).toBeNull()
  })

  it('acepta solo una ruta local con query', () => {
    expect(safeInternalRoute('/citas?vista=semana&fecha=2026-10-01')).toBe('/citas?vista=semana&fecha=2026-10-01')
    expect(postLoginRoute('https://otro.test', null, identity, false)).toBe('/')
  })
})

describe('límite de reenvío de verificación', () => {
  const now = new Date('2026-09-28T12:00:00Z')
  it('exige un minuto entre envíos', () => {
    expect(canResendVerification([new Date(now.getTime() - 59_000)], now)).toBe(false)
    expect(canResendVerification([new Date(now.getTime() - 60_000)], now)).toBe(true)
  })
  it('limita a cinco durante la última hora incluso al cambiar correo', () => {
    const recent = Array.from({ length: 5 }, (_, index) => new Date(now.getTime() - (index + 1) * 61_000))
    expect(canResendVerification(recent, now)).toBe(false)
    expect(canResendVerification(recent, now, true)).toBe(false)
    expect(canResendVerification(recent.slice(0, 4), now, true)).toBe(true)
  })
})
