// Pedido directo del usuario (2026-09-05): "quiero que los modulos, en el
// listado, tengan un boton que lleve a la edicion del modulo, visible solo
// para el administrador" - antes de este cambio, el unico lugar que sabia si
// el usuario actual es administrador era components/AppNav.vue (prueba
// GET /api/roles, que solo permite entrar con requireAdminRole - HU-ERD-61 -
// y trata cualquier error, tipicamente 403 sin rol admin, como "no admin",
// en vez de duplicar en el frontend la logica real de "es admin" que hoy no
// viaja en /api/auth/me). Se extrae aca como composable reusable en vez de
// copiar el mismo fetch+try/catch en cada pantalla nueva que lo necesite -
// misma key de useAsyncData ('appnav-is-admin') que ya usaba AppNav.vue, asi
// Nuxt deduplica el pedido: AppNav.vue vive en el layout de TODAS las
// paginas, asi que para cualquier pantalla que tambien llame a este
// composable el dato ya esta resuelto (o en vuelo) sin una segunda llamada a
// GET /api/roles por navegacion.
export function useIsAdmin() {
  return useAsyncData('appnav-is-admin', async () => {
    const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
    try {
      await $fetch('/api/roles', { headers })
      return true
    } catch {
      return false
    }
  })
}
