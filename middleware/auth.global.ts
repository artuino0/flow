import { resolveFlowApp } from '~/utils/flowApps'
import { normalizeRegistrationChoice, type RegistrationChoice } from '~/utils/registrationIntent'

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
  const landingChoice = useState<RegistrationChoice | null>('registration-landing-choice', () => null)
  const unavailableChoice = useState<boolean>('registration-plan-unavailable', () => false)
  unavailableChoice.value = false
  if (['/registro', '/login', '/elegir-plan'].includes(to.path)) {
    const incoming = normalizeRegistrationChoice(to.query)
    if (incoming) landingChoice.value = incoming
    else if (to.path === '/registro' || to.query.plan !== undefined) landingChoice.value = null
  }
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
  const accountPromise = !publicRoute && user.value?.authenticated && !needsMe
    ? useRequestFetch()<{ account: import('~/utils/accountLifecycle').AccountLifecycle }>('/api/account/status').then(result => {
      if (!result.account?.phase) throw createError({ statusCode: 503, statusMessage: 'No se pudo comprobar el estado de la cuenta.' })
      if (user.value) user.value.accountLifecycle = result.account
    }) : Promise.resolve()
  await Promise.all([
    !licenseIsFresh || to.path === '/activar'
      ? $fetch<{ required: boolean; activated: boolean }>('/api/license/status').then(status => {
        licenseCache.value = { ...status, fetchedAt: Date.now() }
      }) : Promise.resolve(),
    needsMe ? fetchMe() : Promise.resolve(),
    accountPromise
  ])
  const license = licenseCache.value!
  // La etapa se refresca sin volver a consultar el perfil estable de HU-183.
  const accountPaused = ['suspended', 'pending_deletion'].includes(user.value?.accountLifecycle?.phase ?? '')
  if (accountPaused && !publicRoute) {
    if (user.value?.isPlatformAdmin && to.path.startsWith('/platform')) return
    if (to.path === '/cuenta-suspendida') return
    return navigateTo('/cuenta-suspendida')
  }
  if (!accountPaused && to.path === '/cuenta-suspendida') return navigateTo(user.value?.authenticated ? '/' : '/login')

  if (license.required && !license.activated) {
    if (to.path !== '/activar') return navigateTo({ path: '/activar', query: { redirect: to.fullPath } })
    return
  }
  if (to.path === '/activar') {
    if (license.required) return
    return navigateTo('/login')
  }

  if (to.path.startsWith('/invitacion/')) return
  if (to.path === '/registro') {
    if (!user.value) await fetchMe()
    if (user.value?.authenticated && !user.value.emailVerified && !landingChoice.value) return navigateTo('/confirmar-correo')
    if (landingChoice.value) {
      if (!user.value) await fetchMe()
      if (user.value?.authenticated) {
        // En SSR un redirect abre otra request: guarda antes de salir, sin depender del useState hidratado.
        const choice = user.value.isAdmin
          ? await useRequestFetch()<{ intent: unknown }>('/api/billing/registration-intent', { method: 'POST', body: landingChoice.value })
          : { intent: null }
        landingChoice.value = null
        if (!user.value.emailVerified) return navigateTo('/confirmar-correo')
        if (choice.intent || user.value.onboardingStatus !== 'complete') return navigateTo('/elegir-plan')
        return navigateTo(user.value.isAdmin ? '/ajustes?section=plan' : '/')
      }
    }
    return
  }
  if (to.path === '/verificar-correo') return
  if (to.path === '/recuperar' || to.path.startsWith('/restablecer/')) return

  if (!user.value && !needsMe) await fetchMe()

  const isLoggedIn = Boolean(user.value?.authenticated)
  const hasLandingRequest = isLoggedIn && Boolean(landingChoice.value) && Boolean(user.value?.isAdmin)
  let hasLandingIntent = false
  if (isLoggedIn && landingChoice.value) {
    if (user.value?.isAdmin) {
      const result = await useRequestFetch()<{ intent: { plan: string; interval: string } | null }>('/api/billing/registration-intent', { method: 'POST', body: landingChoice.value })
      hasLandingIntent = Boolean(result.intent)
    }
    landingChoice.value = null
  }
  if (isLoggedIn && to.path !== '/login') useRealtime().resumeSession()
  if (to.path === '/login') {
    if (isLoggedIn) {
      if (!user.value?.emailVerified) return navigateTo('/confirmar-correo')
      if (user.value.onboardingStatus !== 'complete') return navigateTo('/elegir-plan')
      if (hasLandingIntent) return navigateTo('/elegir-plan')
      if (hasLandingRequest) return navigateTo('/ajustes?section=plan')
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
  if (hasLandingIntent && to.path !== '/elegir-plan') return navigateTo('/elegir-plan')
  if (hasLandingRequest && !hasLandingIntent) return navigateTo('/ajustes?section=plan')
  if (to.path === '/elegir-plan') {
    if (!user.value?.isAdmin) return navigateTo('/')
    const choice = await useRequestFetch()<{ intent: unknown; unavailable: boolean }>('/api/billing/registration-intent')
    if (choice.unavailable) unavailableChoice.value = true
    if (choice.intent || choice.unavailable) return
    return navigateTo('/')
  }
  if (to.path === '/confirmar-correo') return navigateTo('/')
  if (to.path === '/registro-completo') return

  const loaded = appsPromise ? await appsPromise : { value: await load(), error: null }
  if (loaded.error) throw loaded.error
  const availability = loaded.value
  const targetApp = resolveFlowApp(to.path)
  const app = availability?.apps.find(candidate => candidate.key === targetApp)
  if (!app?.enabled || !app.accessible) return navigateTo('/')
})
