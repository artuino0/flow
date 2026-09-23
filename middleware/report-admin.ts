// A fresh server check protects direct links even if the client cached an
// earlier administrator session. Report writes have the same server guard.
export default defineNuxtRouteMiddleware(async () => {
  try {
    await $fetch('/api/roles', {
      headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
    })
  } catch {
    return abortNavigation(createError({ statusCode: 403, statusMessage: 'Solo los administradores pueden diseñar reportes' }))
  }
})
