import { describe, it, expect } from 'vitest'
import { generateTotpSecret, totpKeyUri, verifyTotpCode, totpQrCodeDataUrl } from '../../server/utils/totp'
import { generate } from 'otplib'

// HU-ERD-83 (parte 2): pruebas puras de server/utils/totp.ts - sin HTTP ni
// Postgres, mismo criterio que test/unit/rateLimit.test.ts (logica que no
// necesita ninguna infraestructura para probarse).

describe('totp', () => {
  it('genera un secreto base32 distinto en cada llamada', () => {
    const a = generateTotpSecret()
    const b = generateTotpSecret()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Z2-7]+$/) // alfabeto base32 estandar
  })

  it('arma una URI otpauth:// valida con el issuer y el email', () => {
    const uri = totpKeyUri('JBSWY3DPEHPK3PXP', 'user@test.com')
    expect(uri).toMatch(/^otpauth:\/\/totp\//)
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP')
    expect(decodeURIComponent(uri)).toContain('user@test.com')
    expect(decodeURIComponent(uri)).toContain('ERP Dinamico')
  })

  it('acepta un codigo real generado con el mismo secreto', async () => {
    const secret = generateTotpSecret()
    const code = await generate({ secret })
    expect(await verifyTotpCode(secret, code)).toBe(true)
  })

  it('rechaza un codigo incorrecto', async () => {
    const secret = generateTotpSecret()
    expect(await verifyTotpCode(secret, '000000')).toBe(false)
  })

  it('rechaza un codigo con formato invalido sin tirar una excepcion', async () => {
    const secret = generateTotpSecret()
    expect(await verifyTotpCode(secret, '')).toBe(false)
    expect(await verifyTotpCode(secret, 'abcdef')).toBe(false)
    expect(await verifyTotpCode(secret, '12345')).toBe(false)
  })

  it('genera un QR como data: URL de imagen', async () => {
    const uri = totpKeyUri(generateTotpSecret(), 'user@test.com')
    const dataUrl = await totpQrCodeDataUrl(uri)
    expect(dataUrl).toMatch(/^data:image\/png;base64,/)
  })
})
