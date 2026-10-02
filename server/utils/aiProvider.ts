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

/** Diagnóstico seguro: nunca conserva el cuerpo ni el mensaje del proveedor. */
export class AiCompletionError extends Error {
  constructor(public reason: string, public transient = false, public code?: string, public modelUnavailable = false) {
    super(reason)
    this.name = 'AiCompletionError'
  }
}

async function completionHttpError(response: Response) {
  let code: string | undefined
  let modelUnavailable = false
  try {
    const data = await response.json() as { error?: { code?: unknown; param?: unknown; message?: unknown } }
    const value = data.error?.code
    // Solo identificadores de error acotados; no texto libre del proveedor.
    if (typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value)) code = value
    modelUnavailable = response.status === 400 && (code === 'unsupported_model' || code === 'model_not_supported' ||
      (data.error?.param === 'model' && (code === 'unsupported_value' || code === 'invalid_model')) ||
      (typeof data.error?.message === 'string' && /model.{0,120}(not supported|unsupported|does not exist|not found)|(?:unsupported|not supported).{0,40}model/i.test(data.error.message)))
  } catch { /* Un cuerpo no JSON no aporta un código seguro. */ }
  return new AiCompletionError(`provider_http_${response.status}`, response.status === 408 || response.status === 429 || response.status >= 500, code, modelUnavailable)
}

/**
 * Fallo del proveedor de IA tras agotar los reintentos (5xx sostenido, cuota
 * 429, red caída o timeout). Quien llama la traduce a un HTTP 503 recuperable
 * en vez de un 500 genérico (HU-ERD-109b).
 */
export class AiProviderUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AiProviderUnavailableError'
  }
}

/** Con network real (deployment) esto puede tardar varios segundos - igual se corta para no dejar la request colgada para siempre si el proveedor no responde. */
const REQUEST_TIMEOUT_MS = 30_000

export interface AiCompletionParams {
  /** Instrucciones de rol/formato - va aparte del prompt en ambos proveedores. */
  system: string
  /** El pedido puntual (incluye la descripcion del usuario + el catalogo disponible). */
  prompt: string
  /** Opciones por consumidor; los valores previos se conservan al omitirlas. */
  timeoutMs?: number
  maxTokens?: number
  model?: string
  structured?: boolean
  onUsage?: (input: number, output: number) => void
}

type AiProviderName = 'anthropic' | 'openai'

function openAiChatUrl() {
  return `${(process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`
}

/** Solo un error de parámetro de formato permite quitar response_format; otros HTTP siguen siendo errores. */
function rejectsResponseFormat(status: number, body: string) {
  return (status === 400 || status === 422) && /response[_ ]format|json[_ ]object/i.test(body)
}

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
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? REQUEST_TIMEOUT_MS)
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
        max_tokens: params.maxTokens ?? 1024,
        system: params.system,
        messages: [{ role: 'user', content: params.prompt }]
      }),
      signal: controller.signal
    })
    if (!response.ok) {
      if (params.structured) throw await completionHttpError(response)
      const bodyText = await response.text().catch(() => '')
      throw new Error(`Anthropic respondió HTTP ${response.status}${bodyText ? `: ${bodyText.slice(0, 300)}` : ''}`)
    }
    const data = (await response.json()) as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } }
    params.onUsage?.(data.usage?.input_tokens ?? 0, data.usage?.output_tokens ?? 0)
    const text = data.content?.find((block) => block.type === 'text')?.text
    if (!text?.trim() && params.structured) throw new AiCompletionError('empty_output')
    if (!text) throw new Error('La respuesta de Anthropic no incluyó texto')
    return text
  } catch (error) {
    if (params.structured && controller.signal.aborted) throw new AiCompletionError('timeout', true)
    if (params.structured && error instanceof TypeError) throw new AiCompletionError('network_error', true)
    if (params.structured && error instanceof SyntaxError) throw new AiCompletionError('invalid_json')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function completeWithOpenAi(params: AiCompletionParams): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new AiProviderNotConfiguredError('AI_PROVIDER=openai requiere OPENAI_API_KEY en el archivo .env.')
  }
  const model = params.model || process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(openAiChatUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        ...(params.structured ? { response_format: { type: 'json_object' }, max_completion_tokens: params.maxTokens ?? 1500 } : {}),
        messages: [
          { role: 'system', content: params.system },
          { role: 'user', content: params.prompt }
        ]
      }),
      signal: controller.signal
    })
    if (!response.ok) {
      if (params.structured) throw await completionHttpError(response)
      const bodyText = await response.text().catch(() => '')
      throw new Error(`OpenAI respondió HTTP ${response.status}${bodyText ? `: ${bodyText.slice(0, 300)}` : ''}`)
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
    params.onUsage?.(data.usage?.prompt_tokens ?? 0, data.usage?.completion_tokens ?? 0)
    const text = data.choices?.[0]?.message?.content
    if (!text?.trim() && params.structured) throw new AiCompletionError('empty_output')
    if (!text) throw new Error('La respuesta de OpenAI no incluyó texto')
    return text
  } catch (error) {
    if (params.structured && controller.signal.aborted) throw new AiCompletionError('timeout', true)
    if (params.structured && error instanceof TypeError) throw new AiCompletionError('network_error', true)
    if (params.structured && error instanceof SyntaxError) throw new AiCompletionError('invalid_json')
    throw error
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

/**
 * Esperas crecientes entre reintentos por 5xx del diseñador (HU-ERD-109b).
 * Exportada para que las pruebas puedan acortarlas; en producción son 2 s y 5 s.
 */
export const DESIGNER_RETRY_DELAYS_MS = [2_000, 5_000]

/** Milisegundos del header retry-after (segundos o fecha HTTP); null si no viene o no se entiende. */
function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get('retry-after')?.trim()
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(raw)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

function sleepDesign(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const onAbort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Contrato aislado: los reportes conservan su prompt, modelo, timeout y formato previos. */
export async function completeDesignerJson(params: AiCompletionParams): Promise<DesignerCompletion> {
  const provider = readProviderName()
  const apiKey = provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY
  if (!apiKey) throw new AiProviderNotConfiguredError(`AI_PROVIDER=${provider} requiere ${provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} en el archivo .env.`)
  const model = process.env.AI_DESIGNER_MODEL?.trim() || (provider === 'anthropic' ? process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5' : process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini')
  const timeoutMs = Math.min(getDesignerTimeoutMs(), params.timeoutMs ?? getDesignerTimeoutMs())
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  // El presupuesto total (timeoutMs) cubre todos los intentos y sus esperas.
  const deadline = Date.now() + timeoutMs
  const delays = [...DESIGNER_RETRY_DELAYS_MS]
  try {
    const anthropic = provider === 'anthropic'
    const url = anthropic ? 'https://api.anthropic.com/v1/messages' : openAiChatUrl()
    const headers: Record<string, string> = anthropic ? { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
    const openAiBody = {
      model, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: params.system }, { role: 'user', content: params.prompt }]
    }
    const requestBody = anthropic ? {
      model, max_tokens: 8192, system: params.system,
      messages: [{ role: 'user', content: params.prompt }],
      tools: [{ name: 'return_design', description: 'Devuelve el mensaje y el plano completo.', input_schema: { type: 'object', properties: { message: { type: 'string' }, blueprint: { type: 'object' } }, required: ['message', 'blueprint'] } }],
      tool_choice: { type: 'tool', name: 'return_design' }
    } : openAiBody
    const sendRequest = async (payload: unknown) => {
      try {
        return await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal })
      } catch (error) {
        // Red caída, timeout o abort: el proveedor no está disponible, no es un error del plano.
        throw new AiProviderUnavailableError(controller.signal.aborted
          ? `El proveedor de IA no respondió dentro del tiempo límite (${timeoutMs} ms).`
          : `No se pudo contactar al proveedor de IA: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
      }
    }
    let rateLimitRetried = false
    for (let attempt = 0; ; attempt++) {
      const response = await sendRequest(requestBody)
      if (response.status === 429 || response.status >= 500) {
        const saturated = response.status >= 500
        const canRetry = saturated ? attempt < delays.length : !rateLimitRetried
        if (!canRetry) {
          throw new AiProviderUnavailableError(saturated
            ? `El proveedor de IA respondió HTTP ${response.status} tras ${attempt + 1} intentos.`
            : 'El proveedor de IA rechazó la petición por cuota (HTTP 429).')
        }
        if (saturated) {
          await sleepDesign(Math.max(0, Math.min(delays[attempt]!, deadline - Date.now())), controller.signal)
            .catch(() => { throw new AiProviderUnavailableError(`El proveedor de IA no respondió dentro del tiempo límite (${timeoutMs} ms).`) })
        } else {
          rateLimitRetried = true
          const wait = retryAfterMs(response) ?? delays[0] ?? 0
          await sleepDesign(Math.max(0, Math.min(wait, deadline - Date.now())), controller.signal)
            .catch(() => { throw new AiProviderUnavailableError(`El proveedor de IA no respondió dentro del tiempo límite (${timeoutMs} ms).`) })
        }
        continue
      }
      let finalResponse = response
      if (!response.ok && !anthropic) {
        const bodyText = await response.text()
        if (!rejectsResponseFormat(response.status, bodyText)) throw new Error(`${provider} respondió HTTP ${response.status}: ${bodyText.slice(0, 300)}`)
        finalResponse = await sendRequest({ model, messages: openAiBody.messages })
      }
      if (!finalResponse.ok) throw new Error(`${provider} respondió HTTP ${finalResponse.status}: ${(await finalResponse.text()).slice(0, 300)}`)
      if (anthropic) {
        const data = await finalResponse.json() as { content?: Array<{ type: string; name?: string; input?: unknown }>; usage?: { input_tokens?: number; output_tokens?: number }; model?: string }
        const value = data.content?.find(block => block.type === 'tool_use' && block.name === 'return_design')?.input
        if (!value) throw new Error('La respuesta de Anthropic no incluyó el plano estructurado')
        return { value, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0, model: data.model || model }
      }
      const data = await finalResponse.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string }
      const content = data.choices?.[0]?.message?.content
      if (!content) throw new Error('La respuesta de OpenAI no incluyó el plano estructurado')
      return { value: JSON.parse(content) as unknown, inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0, model: data.model || model }
    }
  } finally {
    clearTimeout(timeout)
  }
}
