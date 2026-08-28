// HU-ERD-22: guard global de rutas. Si no hay sesion, redirige a /login;
// si ya hay sesion y el usuario intenta entrar a /login, lo manda al home.
export default defineNuxtRouteMiddleware(async (to) => {
  const { user, fetchMe } = useAuth()

  if (!user.value) {
    await fetchMe()
  }

  const isLoggedIn = Boolean(user.value?.authenticated)

  if (to.path === '/login') {
    if (isLoggedIn) return navigateTo('/')
    return
  }

  if (!isLoggedIn) {
    return navigateTo('/login')
  }
})
