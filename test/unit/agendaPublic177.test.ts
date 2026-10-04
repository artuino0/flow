import { beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { agendaSiteSettingsSchema, normalizeAgendaPhone, publicBookSchema, publicSlotsSchema, publicTokenSchema } from '../../utils/agendaPublic'
import { agendaFormToken, agendaHash, agendaOpaqueId, agendaRequestLimit, canManageAgenda, newAgendaToken, validAgendaFormToken } from '../../server/utils/agendaPublicSecurity'
import { resetPublicRateLimits } from '../../server/utils/rateLimit'
const site = randomUUID(), page = randomUUID(), now = Date.parse('2026-10-04T12:00:00Z')
const book = () => ({ site, page, services: ['a'.repeat(32)], date: '2026-10-05', time: '09:00', personal: 'any', client: { name: 'Ana', email: 'ANA@example.test', phone: '+52 (477) 123-4567' }, formToken: agendaFormToken(site, page, now - 3000) })
beforeEach(resetPublicRateLimits)
describe('Contrato público de agenda 177', () => {
  it('normaliza contactos y rechaza campos extra, HTML, tamaños y contactos inválidos', () => {
    expect(publicBookSchema.parse(book()).client).toEqual({ name: 'Ana', email: 'ana@example.test', phone: '524771234567' })
    for (const input of [{ ...book(), tenantId: randomUUID() }, { ...book(), client: { ...book().client, role: 'Administrador' } }, { ...book(), client: { ...book().client, name: '<b>Ana</b>' } }, { ...book(), client: { ...book().client, name: 'x'.repeat(161) } }, { ...book(), services: Array(31).fill('a'.repeat(32)) }, { ...book(), client: { ...book().client, phone: 'abc' } }]) expect(publicBookSchema.safeParse(input).success).toBe(false)
    expect(normalizeAgendaPhone('+52 (477) 123-4567')).toBe('524771234567')
  })
  it('ventana inclusiva máxima de 14 días, sin IDs internos ni query de token', () => {
    const query = { site, page, from: '2026-10-05', to: '2026-10-18' }
    expect(publicSlotsSchema.safeParse(query).success).toBe(true)
    expect(publicSlotsSchema.safeParse({ ...query, to: '2026-10-19' }).success).toBe(false)
    expect(publicSlotsSchema.safeParse({ ...query, personal: randomUUID() }).success).toBe(false)
    expect(publicSlotsSchema.safeParse({ ...query, token: newAgendaToken() }).success).toBe(false)
  })
  it('tokens de 256 bits únicos, SHA256 y IDs opacos separados por sitio y tipo', () => {
    const tokens = Array.from({ length: 100 }, newAgendaToken)
    expect(new Set(tokens).size).toBe(100)
    for (const token of tokens) { expect(publicTokenSchema.safeParse({ site, page, token }).success).toBe(true); expect(agendaHash(token)).toMatch(/^[a-f0-9]{64}$/); expect(agendaHash(token)).not.toContain(token) }
    expect(agendaOpaqueId(site, 'person', page)).not.toBe(agendaOpaqueId(site, 'service', page))
    expect(agendaOpaqueId(site, 'person', page)).not.toBe(agendaOpaqueId(page, 'person', page))
  })
  it('formulario firmado: tiempo mínimo, máximo, alteración y otro sitio', () => {
    const token = agendaFormToken(site, page, now)
    expect(validAgendaFormToken(token, site, page, now + 2000)).toBe(true)
    expect(validAgendaFormToken(token, site, page, now + 1999)).toBe(false)
    expect(validAgendaFormToken(token, site, page, now + 7200001)).toBe(false)
    expect(validAgendaFormToken(token + 'a', site, page, now + 3000)).toBe(false)
    expect(validAgendaFormToken(token, page, site, now + 3000)).toBe(false)
  })
  it('plazo exacto, vencido y hora inexistente', () => {
    expect(canManageAgenda(now + 24 * 3600000, 24, now)).toBe(true)
    expect(canManageAgenda(now + 24 * 3600000 - 1, 24, now)).toBe(false)
    expect(canManageAgenda(now, 0, now)).toBe(false)
    expect(canManageAgenda(null, 0, now)).toBe(false)
  })
  it('límites por IP, sitio y contacto, con vencimiento', () => {
    for (let i = 0; i < 60; i++) agendaRequestLimit('slots', 'ip', site, [], now)
    expect(() => agendaRequestLimit('slots', 'ip', site, [], now)).toThrow()
    expect(() => agendaRequestLimit('slots', 'ip', site, [], now + 900000)).not.toThrow()
    resetPublicRateLimits()
    for (let i = 0; i < 5; i++) agendaRequestLimit('book', 'ip' + i, site, ['ana@test.local'], now)
    expect(() => agendaRequestLimit('book', 'other', site, ['ana@test.local'], now)).toThrow()
    resetPublicRateLimits()
    for (let i = 0; i < 300; i++) agendaRequestLimit('slots', 'ip' + i, site, [], now)
    expect(() => agendaRequestLimit('slots', 'new', site, [], now)).toThrow()
  })
  it('configuración estricta, acento semántico y valores por omisión', () => {
    expect(agendaSiteSettingsSchema.parse({})).toMatchObject({ enabled: false, maxActiveBookings: 3, assignmentMode: null, clientFields: { email: 'correo' }, accent: 'primary' })
    expect(agendaSiteSettingsSchema.safeParse({ accent: '#ffffff' }).success).toBe(false)
    expect(agendaSiteSettingsSchema.safeParse({ clientFields: { name: 'nombre', email: 'nombre' } }).success).toBe(false)
  })
})
