<script setup lang="ts">
import { Monitor, LogOut } from '@lucide/vue'
const { logout } = useAuth()
const toast = useToast()
const target = ref('')
const busy = ref(false)
const { data: sessions, error, refresh } = await useFetch<Array<{ id: string; userAgent: string; current: boolean; lastSeenAt: string }>>('/api/auth/sessions', { headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined })
function device(ua: string) {
  const browser = ua.includes('Edg/') ? 'Edge' : ua.includes('Firefox/') ? 'Firefox' : ua.includes('Chrome/') ? 'Chrome' : ua.includes('Safari/') ? 'Safari' : 'Navegador'
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'dispositivo'
  return browser + ' en ' + os
}
async function closeSession() {
  busy.value = true
  try {
    await $fetch('/api/auth/sessions/' + target.value, { method: 'DELETE' })
    if (target.value === 'all' || sessions.value?.find(s => s.id === target.value)?.current) { await logout(); await navigateTo('/login'); return }
    target.value = ''; await refresh(); toast.success('Sesión cerrada', 'Ese dispositivo ya no tiene acceso.')
  } catch { toast.error('No se pudo cerrar la sesión', 'Intenta nuevamente.') }
  finally { busy.value = false }
}
</script>
<template>
  <section class="rounded-lg border border-brand-border-light bg-white p-6">
    <div class="flex flex-wrap items-center justify-between gap-3"><h2 class="text-[15px] font-bold text-brand-text">Sesiones activas</h2><button v-if="sessions?.length" class="text-xs font-semibold text-brand-error-text" @click="target = 'all'">Cerrar todas las sesiones</button></div>
    <p class="mt-1 text-[13px] text-brand-text-secondary">Dispositivos donde has iniciado sesión en esta organización</p>
    <p v-if="error" role="alert" class="mt-4 text-sm text-brand-error-text">No se pudieron cargar las sesiones. <button class="underline" @click="refresh()">Reintentar</button></p>
    <p v-else-if="!sessions?.length" class="mt-4 text-sm text-brand-text-muted">Tu sesión aparecerá al renovarse o volver a iniciar sesión.</p>
    <div v-for="session in sessions" :key="session.id" class="mt-4 flex items-center gap-3 border-t border-brand-border-light pt-4"><Monitor class="h-9 w-9 rounded bg-brand-blue-bg p-2 text-brand-blue" /><div class="min-w-0 flex-1"><p class="text-sm font-semibold text-brand-text">{{ device(session.userAgent) }}</p><p class="mt-1 text-xs text-brand-text-muted">Última actividad: {{ new Date(session.lastSeenAt).toLocaleString('es-MX') }}</p></div><span v-if="session.current" class="rounded-full bg-brand-success-bg px-2 py-1 text-xs text-brand-success-text">Este dispositivo</span><button v-else class="text-brand-text-secondary" :aria-label="'Cerrar sesión en ' + device(session.userAgent)" @click="target = session.id"><LogOut class="h-4 w-4" /></button></div>
  </section>
  <div v-if="target" role="dialog" aria-modal="true" aria-labelledby="session-confirm" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div class="w-full max-w-md rounded-lg bg-white p-6"><h2 id="session-confirm" class="font-bold text-brand-text">{{ target === 'all' ? 'Cerrar todas las sesiones' : 'Cerrar esta sesión' }}</h2><p class="mt-3 text-sm text-brand-text-secondary">{{ target === 'all' ? 'También se cerrará tu sesión actual. Tendrás que volver a iniciar sesión.' : 'El dispositivo tendrá que volver a iniciar sesión para acceder.' }}</p><div class="mt-6 flex justify-end gap-3"><button :disabled="busy" class="rounded border border-brand-border px-3 py-2 text-sm" @click="target = ''">Cancelar</button><button :disabled="busy" class="rounded bg-brand-orange px-3 py-2 text-sm font-semibold text-white" @click="closeSession">{{ busy ? 'Cerrando…' : 'Cerrar sesión' }}</button></div></div></div>
</template>
