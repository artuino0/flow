<script setup lang="ts">
import { Bell, Check, ExternalLink } from '@lucide/vue'

const open = ref(false)
const root = ref<HTMLElement>()
const { state, start, stop, markRead, markAllRead, requestAlerts } = useNotifications()

onMounted(() => {
  start()
  window.addEventListener('click', closeOnOutside)
})
onBeforeUnmount(() => {
  window.removeEventListener('click', closeOnOutside)
  stop()
})
function closeOnOutside(event: MouseEvent) {
  if (!root.value?.contains(event.target as Node)) open.value = false
}
function toggleOpen() {
  open.value = !open.value
  if (open.value) void requestAlerts()
}
function relativeDate(value: string) {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000)
  if (minutes < 1) return 'Ahora'
  if (minutes < 60) return `Hace ${minutes} min`
  if (minutes < 1440) return `Hace ${Math.floor(minutes / 60)} h`
  return new Date(value).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}
async function openNotification(item: typeof state.value.items[number]) {
  await markRead(item.id)
  open.value = false
  if (item.actionUrl) await goToAction(item.actionUrl)
}
async function goToAction(url: string) {
  if (url.startsWith('/')) return await navigateTo(url)
  return await navigateTo(url, { external: true })
}
</script>

<template>
  <div ref="root" class="relative">
    <button type="button" title="Notificaciones" aria-label="Notificaciones" :aria-expanded="open" class="relative flex h-8 w-8 items-center justify-center rounded text-brand-text-secondary hover:bg-brand-bg" @click.stop="toggleOpen">
      <Bell class="h-[17px] w-[17px]" :stroke-width="1.75" />
      <span v-if="state.unreadCount" class="absolute right-0.5 top-0.5 flex min-w-[15px] translate-x-1/4 -translate-y-1/4 items-center justify-center rounded-full bg-brand-orange px-1 text-[9px] font-bold leading-[15px] text-white">{{ state.unreadCount > 99 ? '99+' : state.unreadCount }}</span>
    </button>

    <div v-if="open" class="absolute right-0 top-full z-50 mt-2 w-[360px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-brand-border-light bg-white shadow-[0_8px_24px_#33475B22]">
      <header class="flex items-center justify-between border-b border-brand-border-light px-4 py-3">
        <div><h2 class="text-sm font-bold text-brand-text">Notificaciones</h2><p class="mt-0.5 text-[11px] text-brand-text-muted">{{ state.connected ? 'Actualizadas en tiempo real' : 'Actualizando automáticamente' }}</p></div>
        <button v-if="state.unreadCount" type="button" class="flex items-center gap-1 text-[11px] font-semibold text-brand-blue hover:underline" @click="markAllRead"><Check class="h-3.5 w-3.5" />Marcar como leídas</button>
      </header>
      <div v-if="!state.items.length" class="px-5 py-10 text-center text-sm text-brand-text-muted">No tienes notificaciones.</div>
      <ul v-else class="max-h-[390px] overflow-y-auto">
        <li v-for="item in state.items" :key="item.id" class="border-b border-brand-border-light last:border-b-0">
          <button type="button" class="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-brand-bg" :class="item.readAt ? 'opacity-70' : 'bg-brand-blue-bg/30'" @click="openNotification(item)">
            <span class="mt-1 h-2 w-2 shrink-0 rounded-full" :class="item.readAt ? 'bg-transparent' : 'bg-brand-orange'" />
            <span class="min-w-0 flex-1"><strong class="block truncate text-[13px] font-semibold text-brand-text">{{ item.title }}</strong><span class="mt-0.5 block text-xs leading-5 text-brand-text-secondary">{{ item.message }}</span><span class="mt-1 flex items-center gap-1 text-[10px] text-brand-text-muted">{{ relativeDate(item.createdAt) }}<ExternalLink v-if="item.actionUrl" class="h-3 w-3" /></span></span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
