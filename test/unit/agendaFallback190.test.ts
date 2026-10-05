import { beforeEach, expect, it, vi } from 'vitest'
import { persistentAgendaLimit } from '../../server/utils/agendaPersistentLimit'
import { resetPublicRateLimits } from '../../server/utils/rateLimit'
import type { PublicAgendaContext } from '../../server/utils/agendaPublic'
vi.mock('../../server/db', () => ({ withTenant: async () => { throw new Error('BD simulada caída con información privada') } }))
const context: PublicAgendaContext = { tenantId: 'tenant190', site: 'site190', page: 'page190', origin: 'https://sitio.test', fingerprint: 'hashed', userAgent: '' }
beforeEach(resetPublicRateLimits)
it('degrada a dos escrituras, conserva límite global del sitio y registra solo sitio/motivo', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await persistentAgendaLimit(context, 'book'); await persistentAgendaLimit(context, 'book')
  await expect(persistentAgendaLimit(context, 'book')).rejects.toMatchObject({ statusCode: 429 })
  const logs = warn.mock.calls.filter(call => String(call[0]).startsWith('{')).map(call => JSON.parse(String(call[0])) as Record<string, unknown>)
  expect(logs).toHaveLength(6)
  expect(logs.some(log => log.reason === 'database_fallback')).toBe(true)
  for (const log of logs) expect(Object.keys(log).sort()).toEqual(['level', 'message', 'reason', 'site', 'timestamp'])
  warn.mockRestore()
})
