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
  if (!licenseIsFresh || to.path === '/activar') {
    const status = await $fetch<{ required: boolean; activated: boolean }>('/api/license/status')
    licenseCache.value = { ...status, fetchedAt: Date.now() }
  }
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
  if (to.path === '/recuperar' || to.path.startsWith('/restablecer/')) return

  const { user, fetchMe } = useAuth()
  if (!user.value) await fetchMe()

  const isLoggedIn = Boolean(user.value?.authenticated)
  if (isLoggedIn && to.path !== '/login') useRealtime().resumeSession()
  if (to.path === '/login') {
    if (isLoggedIn) return navigateTo('/')
    return
  }
  if (!isLoggedIn) return navigateTo({ path: '/login', query: { redirect: to.fullPath } })

  const { load } = useFlowAppAccess()
  const availability = await load()
  const targetApp = resolveFlowApp(to.path)
  const app = availability?.apps.find(candidate => candidate.key === targetApp)
  if (!app?.enabled || !app.accessible) return navigateTo('/')
})
