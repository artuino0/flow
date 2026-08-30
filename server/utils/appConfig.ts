// HU-ERD-35: patron "Core + Config" - modo de la aplicacion y feature flags
// centralizados en variables de entorno. Funciones puras (solo process.env,
// sin useRuntimeConfig()/contexto de Nitro) a proposito, para poder testearlas
// con vitest normal (mismo criterio que buildFieldType, HU-ERD-17/29) y porque
// no cambian durante la vida del proceso - no hace falta pasar por el
// mecanismo de runtimeConfig de Nuxt para leerlas server-side.
//
// El frontend NO lee estas variables via runtimeConfig.public de Nuxt (ese
// bloque se resuelve una sola vez al buildear y queda horneado en el output -
// cambiar la variable de entorno al levantar el server compilado despues NO
// lo actualiza). En cambio, GET /api/config (server/api/config.get.ts) llama
// a estas mismas funciones en cada request y el frontend lo consume via
// composables/useDeploymentConfig.ts - asi se sigue leyendo "en runtime" de verdad,
// sin rebuild, como pide HU-ERD-35. Descubierto validando esta HU con un e2e
// real que arrancaba el mismo build compilado con env vars distintas.

export type AppMode = 'saas' | 'dedicated'

/**
 * "saas": un mismo deployment sirve a multiples tenants - el login pide
 * explicitamente cual (campo "Organizacion", HU-ERD-22). "dedicated":
 * instancia de un solo cliente - el (unico) tenant se resuelve solo,
 * sin pedirselo al usuario (server/api/auth/login.post.ts, pages/login.vue).
 * Default "saas" si la variable no esta seteada o tiene cualquier otro valor.
 */
export function getAppMode(): AppMode {
  return process.env.APP_MODE === 'dedicated' ? 'dedicated' : 'saas'
}

/**
 * Feature flag por convencion de nombre: `FEATURE_<NOMBRE EN MAYUSCULAS>`.
 * Habilitado por default (si la variable no esta seteada) - un flag ausente
 * nunca apaga algo por accidente. "false" o "0" (case-insensitive) lo apagan;
 * cualquier otro valor (incluido "true" o vacio) lo deja habilitado.
 */
export function isFeatureEnabled(name: string): boolean {
  const raw = process.env[`FEATURE_${name.toUpperCase()}`]
  if (raw === undefined) return true
  const normalized = raw.trim().toLowerCase()
  return normalized !== 'false' && normalized !== '0'
}
