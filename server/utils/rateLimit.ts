// HU-ERD-83 (parte 1): limitar intentos de login fallidos - mitiga fuerza
// bruta/credential stuffing contra una cuenta puntual. Implementacion en
// memoria del proceso (Map), NO distribuida - suficiente para el modo de
// despliegue actual del proyecto (un unico proceso Nitro, sin balanceo
// horizontal); si en el futuro se corre mas de una instancia, esto necesita
// migrar a un store compartido (Redis u otro) - documentado explicitamente
// como limite conocido, no un descuido.

const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000 // 15 minutos

const attemptsByKey = new Map<string, number[]>()

function pruneOld(timestamps: number[], now: number): number[] {
  return timestamps.filter((t) => now - t < WINDOW_MS)
}

export interface RateLimitStatus {
  blocked: boolean
  /** Solo tiene sentido cuando blocked=true. */
  retryAfterSeconds: number
}

/** Consulta si `key` esta bloqueada ahora mismo, sin registrar ningun intento nuevo. */
export function checkLoginRateLimit(key: string): RateLimitStatus {
  const now = Date.now()
  const timestamps = pruneOld(attemptsByKey.get(key) ?? [], now)
  attemptsByKey.set(key, timestamps)

  if (timestamps.length < MAX_ATTEMPTS) return { blocked: false, retryAfterSeconds: 0 }

  const oldestInWindow = timestamps[0]
  const retryAfterSeconds = Math.max(1, Math.ceil((WINDOW_MS - (now - oldestInWindow)) / 1000))
  return { blocked: true, retryAfterSeconds }
}

/** Registra un intento de login FALLIDO para `key` (llamar solo tras credenciales invalidas). */
export function recordFailedLoginAttempt(key: string): void {
  const now = Date.now()
  const timestamps = pruneOld(attemptsByKey.get(key) ?? [], now)
  timestamps.push(now)
  attemptsByKey.set(key, timestamps)
}

/** Limpia los intentos fallidos de `key` (llamar tras un login exitoso). */
export function clearLoginRateLimit(key: string): void {
  attemptsByKey.delete(key)
}

/** Solo para tests: vacia todo el estado en memoria entre casos. */
export function resetAllRateLimits(): void {
  attemptsByKey.clear()
}

/** Reutiliza los mismos límites del login para una clave de recuperación. */
export const checkPasswordResetRateLimit = checkLoginRateLimit
export const recordPasswordResetAttempt = recordFailedLoginAttempt

// Mismo mecanismo de timestamps que login, con límites independientes para
// entradas públicas. Mapa acotado: rechazar claves nuevas al llenarse evita
// que rotar IPs expulse buckets activos y eluda sus límites.
const publicAttempts = new Map<string, number[]>()
export function consumeRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitStatus {
  if (publicAttempts.size >= 10000) {
    for (const [entry, timestamps] of publicAttempts) if (!timestamps.length || now - timestamps[timestamps.length - 1]! >= windowMs) publicAttempts.delete(entry)
    if (!publicAttempts.has(key) && publicAttempts.size >= 10000) return { blocked: true, retryAfterSeconds: Math.ceil(windowMs / 1000) }
  }
  const timestamps = (publicAttempts.get(key) ?? []).filter(time => now - time < windowMs)
  if (timestamps.length >= limit) return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - now + timestamps[0]!) / 1000)) }
  timestamps.push(now)
  publicAttempts.set(key, timestamps)
  return { blocked: false, retryAfterSeconds: 0 }
}
export function resetPublicRateLimits() { publicAttempts.clear() }
