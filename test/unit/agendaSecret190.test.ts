import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { agendaFormToken, validAgendaFormToken } from '../../server/utils/agendaPublicSecurity'
afterEach(() => vi.unstubAllEnvs())
it('el token sobrevive a recargar el módulo con el mismo secreto; rotarlo lo invalida', async () => {
  vi.stubEnv('JWT_SECRET', 'secret-test-stable-190')
  const site = randomUUID(), page = randomUUID(), now = Date.now(), token = agendaFormToken(site, page, now - 3000)
  vi.resetModules(); const restarted = await import('../../server/utils/agendaPublicSecurity')
  expect(restarted.validAgendaFormToken(token, site, page, now)).toBe(true)
  vi.stubEnv('JWT_SECRET', 'secret-test-rotated-190'); expect(validAgendaFormToken(token, site, page, now)).toBe(false)
})
it('producción sin secreto estable falla cerrada', () => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('JWT_SECRET', '')
  expect(() => agendaFormToken(randomUUID(), randomUUID())).toThrow('Falta el secreto estable')
})
