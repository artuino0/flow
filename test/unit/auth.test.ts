import { describe, it, expect } from 'vitest'
import {
  signAuthToken,
  verifyAuthToken,
  signPendingTotpToken,
  verifyPendingTotpToken,
  signPendingOrgToken,
  verifyPendingOrgToken,
  signRefreshToken,
  verifyRefreshToken,
  resolveAuthToken,
  getBearerToken
} from '../../server/utils/auth'

// HU-ERD-83 (parte 2): pruebas puras de server/utils/auth.ts - los tres
// tipos de token que conviven ahi (sesion real, totp-pending, refresh) nunca
// habian tenido un test unitario propio pese a que el flujo entero de login
// depende de ellos. Sin HTTP ni Postgres, mismo criterio que
// test/unit/rateLimit.test.ts.

const SECRET = 'test-secret-no-usar-en-produccion'

describe('auth: access token', () => {
  it('firma y verifica un access token, ida y vuelta', () => {
    const token = signAuthToken({ sub: 'u1', tenantId: 't1', roleId: 'r1' }, SECRET)
    const decoded = verifyAuthToken(token, SECRET)
    expect(decoded.sub).toBe('u1')
    expect(decoded.tenantId).toBe('t1')
    expect(decoded.roleId).toBe('r1')
  })

  it('rechaza un access token firmado con otro secreto', () => {
    const token = signAuthToken({ sub: 'u1', tenantId: 't1', roleId: null }, SECRET)
    expect(() => verifyAuthToken(token, 'otro-secreto')).toThrow()
  })
})

describe('auth: totp-pending token', () => {
  it('firma y verifica, ida y vuelta', () => {
    // HU multi-organizacion (2026-09-04): ya no lleva tenantId - la
    // organización todavia no se eligio en este punto del login (ver el
    // comentario largo en server/utils/auth.ts).
    const token = signPendingTotpToken({ sub: 'u1' }, SECRET)
    const decoded = verifyPendingTotpToken(token, SECRET)
    expect(decoded.sub).toBe('u1')
  })

  it('rechaza un access token normal presentado como si fuera totp-pending', () => {
    // Mismo secreto, pero sin el claim `purpose: 'totp-pending'` - es la
    // verificacion que evita que un access token real (o cualquier JWT
    // firmado con el mismo secreto que no sea explicitamente de este tipo)
    // se cuele como token intermedio de 2FA.
    const accessToken = signAuthToken({ sub: 'u1', tenantId: 't1', roleId: null }, SECRET)
    expect(() => verifyPendingTotpToken(accessToken, SECRET)).toThrow()
  })
})

describe('auth: refresh token', () => {
  it('firma y verifica, ida y vuelta', () => {
    const token = signRefreshToken({ sub: 'u1', tenantId: 't1' }, SECRET)
    const decoded = verifyRefreshToken(token, SECRET)
    expect(decoded.sub).toBe('u1')
    expect(decoded.tenantId).toBe('t1')
  })

  it('rechaza un access token normal presentado como si fuera refresh', () => {
    // Mismo motivo que el caso analogo de totp-pending arriba - server/middleware/auth.ts
    // hace el chequeo inverso (rechaza un totp-pending que se intente usar
    // como access token); este test cubre que un token de OTRO tipo tampoco
    // sirva como refresh.
    const accessToken = signAuthToken({ sub: 'u1', tenantId: 't1', roleId: null }, SECRET)
    expect(() => verifyRefreshToken(accessToken, SECRET)).toThrow()
  })

  it('un totp-pending tampoco sirve como refresh token', () => {
    const pendingToken = signPendingTotpToken({ sub: 'u1' }, SECRET)
    expect(() => verifyRefreshToken(pendingToken, SECRET)).toThrow()
  })
})

describe('auth: org-pending token', () => {
  it('firma y verifica, ida y vuelta', () => {
    const token = signPendingOrgToken({ sub: 'u1' }, SECRET)
    const decoded = verifyPendingOrgToken(token, SECRET)
    expect(decoded.sub).toBe('u1')
  })

  it('rechaza un access token normal presentado como si fuera org-pending', () => {
    const accessToken = signAuthToken({ sub: 'u1', tenantId: 't1', roleId: null }, SECRET)
    expect(() => verifyPendingOrgToken(accessToken, SECRET)).toThrow()
  })

  it('un totp-pending no sirve como org-pending, ni viceversa', () => {
    const totpToken = signPendingTotpToken({ sub: 'u1' }, SECRET)
    expect(() => verifyPendingOrgToken(totpToken, SECRET)).toThrow()
    const orgToken = signPendingOrgToken({ sub: 'u1' }, SECRET)
    expect(() => verifyPendingTotpToken(orgToken, SECRET)).toThrow()
  })
})

describe('resolveAuthToken / getBearerToken', () => {
  it('prioriza el header Authorization sobre la cookie', () => {
    expect(resolveAuthToken('Bearer abc123', 'cookie-token')).toBe('abc123')
  })

  it('cae a la cookie si no hay header', () => {
    expect(resolveAuthToken(undefined, 'cookie-token')).toBe('cookie-token')
  })

  it('devuelve null si no hay ninguno de los dos', () => {
    expect(resolveAuthToken(undefined, undefined)).toBeNull()
  })

  it('ignora un header Authorization con un scheme distinto de Bearer', () => {
    expect(getBearerToken('Basic abc123')).toBeNull()
  })
})
