import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { agendaSiteSettingsSchema } from '../../utils/agendaPublic'
import { agendaTurnstileKey, verifyAgendaTurnstile } from '../../server/utils/agendaTurnstile'
import type { PublicAgendaContext } from '../../server/utils/agendaPublic'
const { bucket, strict, log } = vi.hoisted(() => ({ bucket: vi.fn(async () => ({ attempts: 1, retryAfter: 1 })), strict: vi.fn(async () => {}), log: vi.fn() }))
vi.mock('../../server/utils/agendaPersistentLimit', () => ({ consumeAgendaBucket: bucket, persistentAgendaLimit: strict, agendaSecurityEvent: log }))
const context: PublicAgendaContext = { site: 'site190', page: 'page190', tenantId: 'tenant190', origin: 'https://sitio.example.test', fingerprint: 'opaque', userAgent: '' }
const config = () => agendaSiteSettingsSchema.parse({})
beforeEach(() => { vi.stubEnv('TURNSTILE_SITE_KEY', 'public-test-190'); vi.stubEnv('TURNSTILE_SECRET_KEY', 'private-test-190'); bucket.mockReset().mockResolvedValue({ attempts: 1, retryAfter: 1 }); strict.mockClear(); log.mockClear() })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
it('apagado sin ambas variables no llama al proveedor; desactivación exige permiso de plataforma', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); vi.stubEnv('TURNSTILE_SECRET_KEY', '')
  await verifyAgendaTurnstile(context, config(), 'book'); expect(fetch).not.toHaveBeenCalled()
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'test'); const disabled = { ...config(), botProtection: 'disabled' as const }
  expect(agendaTurnstileKey(disabled)).toBeDefined(); vi.stubEnv('TURNSTILE_ALLOW_DISABLED', 'true'); expect(agendaTurnstileKey(disabled)).toBeUndefined()
})
it.each([{ success: false }, { success: true, hostname: 'ajeno.test', action: 'book' }, { success: true, hostname: 'sitio.example.test', action: 'cancel' }])('rechaza respuesta incorrecta %j', async response => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response))))
  await expect(verifyAgendaTurnstile(context, config(), 'book', 'token190')).rejects.toMatchObject({ statusCode: 422 })
})
it('acepta hostname/action exactos y no envía IP; token repetido nunca llama siteverify', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ success: true, hostname: 'sitio.example.test', action: 'book' }))); vi.stubGlobal('fetch', fetch)
  await verifyAgendaTurnstile(context, config(), 'book', 'token190'); expect(String(fetch.mock.calls[0])).not.toContain('remoteip')
  bucket.mockResolvedValue({ attempts: 2, retryAfter: 1 }); await expect(verifyAgendaTurnstile(context, config(), 'book', 'token190')).rejects.toMatchObject({ statusCode: 422 }); expect(fetch).toHaveBeenCalledTimes(1)
})
it.each(['allow_strict', 'deny'] as const)('caída del proveedor respeta %s', async policy => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('simulado') }))
  const attempt = verifyAgendaTurnstile(context, { ...config(), turnstileOutage: policy }, 'book', 'token190')
  if (policy === 'deny') await expect(attempt).rejects.toMatchObject({ statusCode: 422 })
  else { await attempt; expect(strict).toHaveBeenCalledWith(context, 'outage:book', [], true, expect.any(Number)) }
  expect(log).toHaveBeenCalledWith(context.site, 'turnstile_unavailable')
})
it('gestión pide desafío solo tras el tercer intento por visitante/sitio', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ success: true, hostname: 'sitio.example.test', action: 'cancel' }))); vi.stubGlobal('fetch', fetch)
  await verifyAgendaTurnstile(context, config(), 'cancel'); expect(fetch).not.toHaveBeenCalled()
  bucket.mockResolvedValueOnce({ attempts: 4, retryAfter: 1 }); await expect(verifyAgendaTurnstile(context, config(), 'cancel')).rejects.toMatchObject({ statusCode: 422, data: { challengeRequired: true } })
})
