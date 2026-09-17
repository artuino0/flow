// HU-ERD-22: guard global de rutas. Si no hay sesion, redirige a /login;
// si ya hay sesion y el usuario intenta entrar a /login, lo manda al home.
export default defineNuxtRouteMiddleware(async (to) => {
  // La persona que abre una invitación todavía no tiene una cuenta activa ni
  // una sesión que validar. El token de la propia URL autoriza únicamente el
  // alta de contraseña mediante el endpoint público de aceptación.
  if (to.path.startsWith('/invitacion/')) return

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
    // Conserva la ruta solicitada para que un enlace profundo (por ejemplo,
    // "Ver detalle" desde un correo) se abra después de iniciar sesión.
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
})
