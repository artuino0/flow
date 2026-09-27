import { afterEach, describe, expect, it, vi } from 'vitest'
import { completeDesignerJson, completeJson } from '../../server/utils/aiProvider'

const reply = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('proveedor compatible con OpenAI', () => {
  it('conserva la URL original cuando OPENAI_BASE_URL no existe', async () => {
    vi.stubEnv('AI_PROVIDER', 'openai')
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubEnv('OPENAI_MODEL', '')
    vi.stubEnv('OPENAI_BASE_URL', '')
    const fetchMock = vi.fn().mockResolvedValue(reply({ choices: [{ message: { content: '{}' } }] }))
    vi.stubGlobal('fetch', fetchMock)
    await completeJson({ system: 's', prompt: 'p' })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/chat/completions')
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body)).toEqual({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'p' }] })
  })

  it('usa la URL personalizada sin duplicar la barra final en reportes y diseñador', async () => {
    vi.stubEnv('AI_PROVIDER', 'openai')
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubEnv('OPENAI_BASE_URL', 'https://example.test/v1///')
    const fetchMock = vi.fn().mockResolvedValueOnce(reply({ choices: [{ message: { content: '{}' } }] })).mockResolvedValueOnce(reply({ choices: [{ message: { content: JSON.stringify({ message: 'Listo', blueprint: {} }) } }] }))
    vi.stubGlobal('fetch', fetchMock)
    await completeJson({ system: 's', prompt: 'p' })
    await completeDesignerJson({ system: 's', prompt: 'p' })
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['https://example.test/v1/chat/completions', 'https://example.test/v1/chat/completions'])
  })

  it('reintenta una sola vez sin response_format si el proveedor rechaza ese parámetro', async () => {
    vi.stubEnv('AI_PROVIDER', 'openai')
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{"error":{"message":"response_format json_object no soportado"}}', { status: 400 })).mockResolvedValueOnce(reply({ choices: [{ message: { content: JSON.stringify({ message: 'Listo', blueprint: {} }) } }] }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await completeDesignerJson({ system: 's', prompt: 'p' })
    expect(result.value).toEqual({ message: 'Listo', blueprint: {} })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body)).toHaveProperty('response_format')
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body)).not.toHaveProperty('response_format')
  })

  it('no elimina el formato ante 429 ni ante errores ajenos al parámetro', async () => {
    vi.stubEnv('AI_PROVIDER', 'openai')
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const fetchMock = vi.fn().mockResolvedValue(new Response('rate limit response_format', { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(completeDesignerJson({ system: 's', prompt: 'p' })).rejects.toThrow('HTTP 429')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
