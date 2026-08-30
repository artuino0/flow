// HU-ERD-35: modo de la app y feature flags, leidos SIEMPRE via GET /api/config
// (calculado fresco en cada request server-side) - nunca via useRuntimeConfig()
// para estas claves, porque runtimeConfig.public se congela en el momento del
// build (ver el comentario en server/api/config.get.ts). Endpoint publico, no
// necesita el forwarding manual de cookie en SSR (HU-ERD-32) que si hace
// falta en los demas composables de este estilo.
export interface PublicAppConfig {
  appMode: 'saas' | 'dedicated'
  featureFlags: {
    dashboard: boolean
  }
}

// Nombre "useDeploymentConfig", no "useAppConfig": Nuxt ya trae un
// useAppConfig() propio (app.config.ts) - sobreescribirlo rompe ese mecanismo.
export function useDeploymentConfig() {
  return useFetch<PublicAppConfig>('/api/config', { key: 'app-config' })
}
