import { getAppMode, isFeatureEnabled } from '~/server/utils/appConfig'

// GET /api/config (HU-ERD-35, publica): modo de la app y feature flags,
// calculados FRESCOS en cada request desde process.env (getAppMode/
// isFeatureEnabled). A proposito NO se expone esto via runtimeConfig.public
// de Nuxt: ese valor se calcula una sola vez cuando corre `nuxt build` y
// queda horneado en el output - cambiar la variable de entorno al levantar
// el server compilado despues NO lo actualiza (Nuxt solo permite
// sobreescribirlo en runtime con su propia convencion NUXT_PUBLIC_<CLAVE>,
// no con el nombre de variable que use el resto del proyecto). Un endpoint
// evita esa trampa por completo y mantiene un unico nombre de variable por
// concepto (APP_MODE, FEATURE_DASHBOARD) en vez de necesitar dos.
export default defineEventHandler(() => {
  const configuredTransport = process.env.REALTIME_TRANSPORT?.trim().toLowerCase()
  const realtimeTransport = configuredTransport === 'websocket' || configuredTransport === 'polling'
    ? configuredTransport
    : (process.env.VERCEL || process.env.VERCEL_ENV ? 'polling' : 'websocket')

  return {
    appMode: getAppMode(),
    realtimeTransport,
    featureFlags: {
      dashboard: isFeatureEnabled('dashboard')
    }
  }
})
