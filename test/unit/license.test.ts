import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyLicenseFile } from '~/server/utils/license'

const keys = generateKeyPairSync('ed25519')
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const expected = { installationId: 'bcb00ae6-499a-4085-b7e1-2a1d5e15a352', machineHash: 'a'.repeat(64) }
const payload = {
  version: 1,
  licenseId: '324974dd-0ee6-44ce-a222-6b797e13bbd9',
  customer: 'Empresa de prueba',
  ...expected,
  issuedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z'
}

function makeLicense(value = payload) {
  const encoded = Buffer.from(JSON.stringify(value)).toString('base64url')
  return JSON.stringify({ payload: encoded, signature: sign(null, Buffer.from(encoded), keys.privateKey).toString('base64url') })
}

describe('licencias offline', () => {
  it('acepta una licencia firmada para esta instalación y máquina', () => {
    const result = verifyLicenseFile(makeLicense(), publicKey, expected, Date.parse('2026-06-01'))
    expect(result.valid).toBe(true)
  })

  it('rechaza una licencia alterada sin la clave privada', () => {
    const file = JSON.parse(makeLicense())
    file.payload = Buffer.from(JSON.stringify({ ...payload, expiresAt: '2035-01-01T00:00:00.000Z' })).toString('base64url')
    expect(verifyLicenseFile(JSON.stringify(file), publicKey, expected, Date.parse('2026-06-01'))).toMatchObject({ valid: false, reason: 'La firma de la licencia no es válida' })
  })

  it('rechaza el traslado de archivo a otra instalación o máquina', () => {
    expect(verifyLicenseFile(makeLicense(), publicKey, { ...expected, machineHash: 'b'.repeat(64) }, Date.parse('2026-06-01'))).toMatchObject({ valid: false, reason: 'Esta licencia pertenece a otra instalación o máquina' })
    expect(verifyLicenseFile(makeLicense(), publicKey, { ...expected, installationId: '6115b01d-4bc0-40ac-bffb-f821a743fb9e' }, Date.parse('2026-06-01'))).toMatchObject({ valid: false, reason: 'Esta licencia pertenece a otra instalación o máquina' })
  })

  it('rechaza una licencia vencida', () => {
    expect(verifyLicenseFile(makeLicense(), publicKey, expected, Date.parse('2027-01-02'))).toMatchObject({ valid: false, reason: 'La licencia venció' })
  })
})
