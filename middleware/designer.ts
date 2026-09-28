export default defineNuxtRouteMiddleware(async () => {
  try {
    await $fetch('/api/module-designer/sessions', { headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined })
  } catch (error) {
    const status = (error as { statusCode?: number; status?: number }).statusCode ?? (error as { status?: number }).status
    if (status === 403) return navigateTo('/ajustes')
    throw error
  }
})
