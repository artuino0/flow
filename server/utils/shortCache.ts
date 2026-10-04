// Caché en memoria de vida corta para datos que cada petición vuelve a leer de la
// base (validación de sesión, permisos, metadatos de los módulos). Cada consulta
// evitada ahorra un viaje a Postgres: con la base en otra red (Neon desde Vercel)
// son de 1 a 3 ms cada uno.
//
// Es por instancia, a propósito: un caché compartido (Redis/KV) costaría otro viaje
// de red parecido al de la base. Por eso lo que se cachea tiene una vida CORTA
// (segundos) y las escrituras que cambian esos datos invalidan la instancia que las
// hizo al instante; las otras instancias lo notan a lo más al vencer el tiempo.
//
// TTL 0 (o negativo) lo desactiva: get() nunca devuelve nada y set() no guarda.

export interface ShortCache<V> {
  get(key: string): V | undefined
  set(key: string, value: V): void
  delete(key: string): void
  /** Borra todas las claves que empiezan con `prefix` (p. ej. `${tenantId}:`). */
  deletePrefix(prefix: string): number
  clear(): void
  readonly size: number
  readonly ttlMs: number
}

export interface ShortCacheOptions {
  ttlMs: number
  /** Tope de entradas: al llenarse se descartan las más antiguas. */
  maxEntries?: number
  now?: () => number
}

export function createShortCache<V>(options: ShortCacheOptions): ShortCache<V> {
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : 0
  const maxEntries = options.maxEntries ?? 5000
  const now = options.now ?? Date.now
  const entries = new Map<string, { value: V; expiresAt: number }>()
  return {
    get(key) {
      if (ttlMs <= 0) return undefined
      const entry = entries.get(key)
      if (!entry) return undefined
      if (entry.expiresAt <= now()) { entries.delete(key); return undefined }
      return entry.value
    },
    set(key, value) {
      if (ttlMs <= 0) return
      entries.delete(key)
      entries.set(key, { value, expiresAt: now() + ttlMs })
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
    },
    delete(key) { entries.delete(key) },
    deletePrefix(prefix) {
      let removed = 0
      for (const key of [...entries.keys()]) if (key.startsWith(prefix)) { entries.delete(key); removed++ }
      return removed
    },
    clear() { entries.clear() },
    get size() { return entries.size },
    ttlMs
  }
}

/** Lee un tiempo en milisegundos de una variable de entorno (0 desactiva; vacío usa el valor por defecto). */
export function ttlFromEnv(name: string, fallbackMs: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallbackMs
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : fallbackMs
}

// Cachés compartidos del servidor. Los tiempos se pueden ajustar (o apagar con 0):
//   SESSION_CACHE_TTL_MS   validación de sesión (por defecto 10 s)
//   ACCESS_CACHE_TTL_MS    permisos de un rol sobre un módulo (por defecto 5 s)
//   METADATA_CACHE_TTL_MS  definición de un módulo: campos, diseños y relaciones (por defecto 30 s)
export const sessionCache = createShortCache<true>({ ttlMs: ttlFromEnv('SESSION_CACHE_TTL_MS', 10_000), maxEntries: 20_000 })
export const accessCache = createShortCache<unknown>({ ttlMs: ttlFromEnv('ACCESS_CACHE_TTL_MS', 5_000), maxEntries: 20_000 })
export const metadataCache = createShortCache<unknown>({ ttlMs: ttlFromEnv('METADATA_CACHE_TTL_MS', 30_000), maxEntries: 2_000 })
let metadataGeneration = 0

/** Copias por consumidor y sin guardar una lectura que cruzó una invalidación. */
export async function cachedTenantMetadata<T>(tenantId: string, scope: string, load: () => Promise<T>): Promise<T> {
  const key = `${tenantId}:${scope}`
  const cached = metadataCache.get(key) as T | undefined
  if (cached !== undefined) return structuredClone(cached)
  const generation = metadataGeneration
  const value = await load()
  if (generation === metadataGeneration) metadataCache.set(key, structuredClone(value))
  return value
}

/**
 * Invalida lo que depende de módulos, campos y permisos de una organización. Se
 * llama desde toda escritura que cambia esos datos. (Las demás instancias del
 * servidor lo notan al vencer el tiempo de cada caché.)
 */
export function invalidateTenantAccess(tenantId: string): void {
  metadataGeneration++
  accessCache.deletePrefix(`${tenantId}:`)
  metadataCache.deletePrefix(`${tenantId}:`)
}

/** Descarta las sesiones validadas en memoria de una organización (tras cerrar/revocar sesiones). */
export function invalidateTenantSessions(tenantId: string): void {
  sessionCache.deletePrefix(`${tenantId}:`)
}

/**
 * Envuelve una escritura (cuyo primer argumento es el id de la organización) para invalidar
 * los cachés de acceso y metadatos al terminar, haya salido bien o mal (una escritura a
 * medias también puede haber cambiado datos).
 */
export function invalidatesTenantAccess<A extends [string, ...unknown[]], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A) => {
    try { return await fn(...args) } finally { invalidateTenantAccess(args[0]) }
  }
}
