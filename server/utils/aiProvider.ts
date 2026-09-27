// Épica ERD-46 (Reportería con IA, hermana de Triggers/ERD-47): capa fina y
// configurable sobre el proveedor de IA que traduce la descripción en
// lenguaje natural de un reporte a un DSL declarativo (server/utils/reportQuery.ts).
//
// Decision del usuario (AskUserQuestion, 2026-09-05): proveedor CONFIGURABLE
// por variable de entorno en vez de atarse a uno solo - AI_PROVIDER elige
// "anthropic" u "openai", cada uno con su propia API key. Mismo criterio que
// server/utils/mailer.ts (HU-ERD-84) para SMTP: sin la variable configurada,
// falla explicito (AiProviderNotConfiguredError) con un mensaje accionable -
// NUNCA un fallback silencioso a "no generar nada" ni a datos inventados.
//
// Se llama directo a la API HTTP de cada proveedor (fetch nativo, mismo
// patron que la accion "webhook" de un trigger en triggerActions.ts) en vez
// de agregar el SDK de cada uno como dependencia - esta capa solo necesita
// "mandar un prompt, recibir texto de vuelta", no el resto de la superficie
// de esos SDKs.
export class AiProviderNotConfiguredError extends Error {}

/** Con network real (deployment) esto puede tardar varios segundos - igual se corta para no dejar la request colgada para siempre si el proveedor no responde. */
const REQUEST_TIMEOUT_MS = 30_000

export interface AiCompletionParams {
  /** Instrucciones de rol/formato - va aparte del prompt en ambos proveedores. */
  system: string
  /** El pedido puntual (incluye la descripcion del usuario + el catalogo disponible). */
  prompt: string
}

type AiProviderName = 'anthropic' | 'openai'

function readProviderName(): AiProviderName {
  const raw = process.env.AI_PROVIDER?.trim().toLowerCase()
  if (raw === 'anthropic' || raw === 'openai') return raw
  throw new AiProviderNotConfiguredError(
    'La generación de reportes con IA no está configurada en este servidor. Definí AI_PROVIDER=anthropic o AI_PROVIDER=openai (y la API key correspondiente) en el archivo .env.'
  )
}

async function completeWithAnthropic(params: AiCompletionParams): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new AiProviderNotConfiguredError('AI_PROVIDER=anthropic requiere ANTHROPIC_API_KEY en el archivo .env.')
  }
  // Sin un modelo "correcto" universal - se deja como variable con un default
  // razonable al momento de esta HU, documentado para que el deployment lo
  // ajuste si Anthropic publica un modelo mas nuevo/economico mientras tanto.
  const model = process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5'

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: params.system,
        messages: [{ role: 'user', content: params.prompt }]
      }),
      signal: controller.signal
    })
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      throw new Error(`Anthropic respondió HTTP ${response.status}${bodyText ? `: ${bodyText.slice(0, 300)}` : ''}`)
    }
    const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> }
    const text = data.content?.find((block) => block.type === 'text')?.text
    if (!text) throw new Error('La respuesta de Anthropic no incluyó texto')
    return text
  } finally {
    clearTimeout(timeout)
  }
}

async function completeWithOpenAi(params: AiCompletionParams): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new AiProviderNotConfiguredError('AI_PROVIDER=openai requiere OPENAI_API_KEY en el archivo .env.')
  }
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: params.system },
          { role: 'user', content: params.prompt }
        ]
      }),
      signal: controller.signal
    })
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      throw new Error(`OpenAI respondió HTTP ${response.status}${bodyText ? `: ${bodyText.slice(0, 300)}` : ''}`)
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const text = data.choices?.[0]?.message?.content
    if (!text) throw new Error('La respuesta de OpenAI no incluyó texto')
    return text
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Manda `system` + `prompt` al proveedor configurado (AI_PROVIDER) y
 * devuelve el texto crudo de la respuesta - quien llama es responsable de
 * parsear/validar ese texto (ver server/utils/reportQuery.ts, que espera
 * JSON y lo valida con Zod antes de confiar en nada de lo que devolvió).
 * Lanza AiProviderNotConfiguredError si falta configuración, o el error del
 * proveedor tal cual (red caída, timeout, HTTP no-2xx) en cualquier otro caso.
 */
export async function completeJson(params: AiCompletionParams): Promise<string> {
  const provider = readProviderName()
  return provider === 'anthropic' ? completeWithAnthropic(params) : completeWithOpenAi(params)
}

export interface DesignerCompletion {
  value: unknown
  inputTokens: number
  outputTokens: number
  model: string
}

export function getDesignerTimeoutMs() {
  const configured = Number(process.env.AI_DESIGNER_TIMEOUT_MS)
  return Number.isFinite(configured) && configured > 0 ? configured : 90_000
}

/** Contrato aislado: los reportes conservan su prompt, modelo, timeout y formato previos. */
export async function completeDesignerJson(params: AiCompletionParams): Promise<DesignerCompletion> {
  const provider = readProviderName()
  const apiKey = provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY
  if (!apiKey) throw new AiProviderNotConfiguredError(`AI_PROVIDER=${provider} requiere ${provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} en el archivo .env.`)
  const model = process.env.AI_DESIGNER_MODEL?.trim() || (provider === 'anthropic' ? process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5' : process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini')
  const timeoutMs = getDesignerTimeoutMs()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const anthropic = provider === 'anthropic'
    const response = await fetch(anthropic ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: anthropic ? { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(anthropic ? {
        model, max_tokens: 8192, system: params.system,
        messages: [{ role: 'user', content: params.prompt }],
        tools: [{ name: 'return_design', description: 'Devuelve el mensaje y el plano completo.', input_schema: { type: 'object', properties: { message: { type: 'string' }, blueprint: { type: 'object' } }, required: ['message', 'blueprint'] } }],
        tool_choice: { type: 'tool', name: 'return_design' }
      } : {
        model, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: params.system }, { role: 'user', content: params.prompt }]
      }),
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`${provider} respondió HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
    if (anthropic) {
      const data = await response.json() as { content?: Array<{ type: string; name?: string; input?: unknown }>; usage?: { input_tokens?: number; output_tokens?: number }; model?: string }
      const value = data.content?.find(block => block.type === 'tool_use' && block.name === 'return_design')?.input
      if (!value) throw new Error('La respuesta de Anthropic no incluyó el plano estructurado')
      return { value, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0, model: data.model || model }
    }
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string }
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('La respuesta de OpenAI no incluyó el plano estructurado')
    return { value: JSON.parse(content) as unknown, inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0, model: data.model || model }
  } finally {
    clearTimeout(timeout)
  }
}
