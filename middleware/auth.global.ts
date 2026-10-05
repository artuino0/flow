import { resolveFlowApp } from '~/utils/flowApps'

interface LicenseCache {
  required: boolean
  activated: boolean
  fetchedAt: number
}

const LICENSE_TTL_MS = 60_000

// Guard global de sesión y acceso. Los datos estables se comparten entre
// navegaciones para que cambiar de pantalla no espere dos consultas remotas
// antes de comenzar a renderizar.
export default defineNuxtRouteMiddleware(async (to) => {
  const licenseCache = useState<LicenseCache | null>('license-status-cache', () => null)
  const licenseIsFresh = licenseCache.value && Date.now() - licenseCache.value.fetchedAt < LICENSE_TTL_MS
  const publicRoute = to.path === '/activar' || to.path.startsWith('/invitacion/') || ['/registro', '/verificar-correo', '/recuperar'].includes(to.path) || to.path.startsWith('/restablecer/')
  const { user, fetchMe } = useAuth()
  const { load } = useFlowAppAccess()
  const knownBlockedLicense = licenseCache.value?.required && !licenseCache.value.activated
  const needsMe = !publicRoute && !knownBlockedLicense && !user.value
  // Los errores de apps se propagan solo si las guardias anteriores dejan llegar a esa comprobación.
  const appsPromise = !publicRoute && to.path !== '/login' && user.value?.emailVerified && user.value.onboardingStatus === 'complete' && !knownBlockedLicense
    ? load().then(value => ({ value, error: null }), error => ({ value: null, error })) : null
  await Promise.all([
    !licenseIsFresh || to.path === '/activar'
      ? $fetch<{ required: boolean; activated: boolean }>('/api/license/status').then(status => {
        licenseCache.value = { ...status, fetchedAt: Date.now() }
      }) : Promise.resolve(),
    needsMe ? fetchMe() : Promise.resolve()
  ])
  const license = licenseCache.value!

  if (license.required && !license.activated) {
    if (to.path !== '/activar') return navigateTo({ path: '/activar', query: { redirect: to.fullPath } })
    return
  }
  if (to.path === '/activar') {
    if (license.required) return
    return navigateTo('/login')
  }

  if (to.path.startsWith('/invitacion/')) return
  if (to.path === '/registro') return
  if (to.path === '/verificar-correo') return
  if (to.path === '/recuperar' || to.path.startsWith('/restablecer/')) return

  if (!user.value && !needsMe) await fetchMe()

  const isLoggedIn = Boolean(user.value?.authenticated)
  if (isLoggedIn && to.path !== '/login') useRealtime().resumeSession()
  if (to.path === '/login') {
    if (isLoggedIn) {
      if (!user.value?.emailVerified) return navigateTo('/confirmar-correo')
      if (user.value.onboardingStatus !== 'complete') return navigateTo('/elegir-plan')
      return navigateTo('/')
    }
    return
  }
  if (!isLoggedIn) return navigateTo({ path: '/login', query: { redirect: to.fullPath } })

  if (!user.value?.emailVerified) {
    if (to.path === '/confirmar-correo') return
    return navigateTo('/confirmar-correo')
  }
  if (user.value.onboardingStatus !== 'complete') {
    if (to.path === '/elegir-plan' || to.path === '/registro-completo') return
    return navigateTo('/elegir-plan')
  }
  if (to.path === '/confirmar-correo' || to.path === '/elegir-plan') return navigateTo('/')
  if (to.path === '/registro-completo') return

  const loaded = appsPromise ? await appsPromise : { value: await load(), error: null }
  if (loaded.error) throw loaded.error
  const availability = loaded.value
  const targetApp = resolveFlowApp(to.path)
  const app = availability?.apps.find(candidate => candidate.key === targetApp)
  if (!app?.enabled || !app.accessible) return navigateTo('/')
})
