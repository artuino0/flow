<script setup lang="ts">
import { KeyRound, Plus, Copy, Trash2 } from '@lucide/vue'

interface ApiKeyRow { id: string; name: string; ownerName: string | null; ownerEmail: string; prefix: string; status: 'active' | 'expired' | 'revoked'; createdAt: string; expiresAt: string | null; lastUsedAt: string | null; scopes: Record<string, unknown> }
const props = defineProps<{ personal?: boolean }>()
const toast = useToast()
const open = ref(true)
const showCreate = ref(false)
const showToken = ref(false)
const token = ref('')
const form = reactive({ name: '', expiresAt: '' })
const scopes = reactive<Record<string, { read: boolean; create: boolean; update: boolean; delete: boolean }>>({})
const scopeActions = [{ key: 'read', label: 'Leer' }, { key: 'create', label: 'Crear' }, { key: 'update', label: 'Actualizar' }, { key: 'delete', label: 'Eliminar' }] as const
const error = ref('')
const saving = ref(false)
const { data: keys, pending, refresh } = await useFetch<ApiKeyRow[]>('/api/settings/api-keys', { key: props.personal ? 'personal-api-keys' : 'company-api-keys', query: { mine: props.personal ? 'true' : 'false' }, headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined })
const { data: entityResponse } = await useFetch<{ entities: Array<{ id: string; slug: string; name: string; read: boolean; create: boolean; update: boolean; delete: boolean }> }>('/api/settings/api-keys/entities', { key: 'settings-api-key-entities', headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined })

function expirationValue() { return form.expiresAt ? new Date(`${form.expiresAt}T23:59:59.000Z`).toISOString() : null }
watch(entityResponse, (value) => { for (const entity of value?.entities || []) scopes[entity.slug] ||= { read: false, create: false, update: false, delete: false } }, { immediate: true })
async function createKey() {
  error.value = ''; saving.value = true
  try {
    const result = await $fetch<{ token: string }>('/api/settings/api-keys', { method: 'POST', body: { name: form.name, expiresAt: expirationValue(), scopes: Object.fromEntries(Object.entries(scopes).filter(([, value]) => Object.values(value).some(Boolean))) } })
    token.value = result.token; showCreate.value = false; showToken.value = true; form.name = ''; form.expiresAt = ''; await refresh()
  } catch (err: any) { error.value = err?.data?.statusMessage || 'No se pudo generar la API key' }
  finally { saving.value = false }
}
async function revoke(key: ApiKeyRow) {
  if (!confirm(`¿Revocar la API key “${key.name}”?`)) return
  try { await $fetch(`/api/settings/api-keys/${key.id}`, { method: 'DELETE' }); await refresh(); toast.updated('API key revocada', 'La integración dejó de tener acceso.') }
  catch (err: any) { toast.error('No se pudo revocar la API key', err?.data?.statusMessage || '') }
}
async function copyToken() { await navigator.clipboard.writeText(token.value); toast.success('Clave copiada', 'Guárdala en un lugar seguro.') }
</script>

<template>
  <section id="api-keys" class="rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
    <button type="button" class="flex w-full items-center justify-between gap-4 p-5 text-left" :aria-expanded="open" @click="open = !open"><span class="flex items-center gap-3"><span class="flex h-8 w-8 items-center justify-center rounded bg-brand-blue-bg"><KeyRound class="h-4 w-4 text-brand-blue" /></span><span><span class="block text-[15px] font-bold text-brand-text">{{ personal ? 'Mis API keys' : 'Administración de API de la empresa' }}</span><span class="block text-[13px] text-brand-text-muted">Conecta FlowERP con otros sistemas usando permisos controlados</span></span></span><span class="flex items-center gap-3"><span class="rounded-full bg-brand-blue-bg px-2.5 py-1 text-xs font-semibold text-brand-blue">{{ keys?.filter(k => k.status === 'active').length || 0 }} activas</span><span class="text-brand-text-muted">⌄</span></span></button>
    <div v-if="open" class="border-t border-brand-border-light p-5">
      <div class="mb-4 flex items-center justify-between"><p class="text-xs text-brand-text-muted">El token completo solo se muestra una vez al crearlo.</p><button v-if="personal" type="button" class="flex items-center gap-1.5 rounded bg-brand-orange px-3 py-2 text-xs font-semibold text-white" @click="showCreate = true"><Plus class="h-3.5 w-3.5" />Generar API key</button></div>
      <p v-if="pending" class="text-sm text-brand-text-muted">Cargando claves...</p>
      <div v-else-if="!keys?.length" class="rounded border border-dashed border-brand-border-light p-6 text-center text-sm text-brand-text-muted">Aún no hay API keys.</div>
      <div v-else class="overflow-x-auto"><table class="w-full text-left text-xs"><thead><tr class="border-b border-brand-border-light text-brand-text-muted"><th class="p-2 font-semibold">Nombre</th><th class="p-2 font-semibold">Propietario</th><th class="p-2 font-semibold">Estado</th><th class="p-2 font-semibold">Último uso</th><th class="p-2"></th></tr></thead><tbody><tr v-for="key in keys" :key="key.id" class="border-b border-brand-border-light last:border-0"><td class="p-2"><div class="font-semibold text-brand-text">{{ key.name }}</div><code class="text-[11px] text-brand-text-muted">{{ key.prefix }}••••••</code></td><td class="p-2 text-brand-text-secondary">{{ key.ownerName || key.ownerEmail }}</td><td class="p-2"><span class="rounded-full px-2 py-0.5 font-semibold" :class="key.status === 'active' ? 'bg-brand-success-bg text-brand-success-text' : key.status === 'expired' ? 'bg-brand-warning-bg text-brand-warning-text' : 'bg-brand-error-bg text-brand-error-text'">{{ key.status === 'active' ? 'Activa' : key.status === 'expired' ? 'Vencida' : 'Revocada' }}</span></td><td class="p-2 text-brand-text-muted">{{ key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'Sin uso' }}</td><td class="p-2 text-right"><button v-if="key.status === 'active'" type="button" class="inline-flex items-center gap-1 rounded px-2 py-1 text-brand-error-text hover:bg-brand-error-bg" @click="revoke(key)"><Trash2 class="h-3.5 w-3.5" />Revocar</button></td></tr></tbody></table></div>
    </div>
  </section>
  <Teleport to="body"><div v-if="showCreate" class="api-modal-overlay" @click.self="showCreate = false"><form class="api-modal" role="dialog" aria-modal="true" aria-labelledby="api-modal-title" @submit.prevent="createKey"><header class="api-modal-header"><div><h2 id="api-modal-title" class="text-base font-bold text-brand-text">Generar API key</h2><p class="mt-1 text-sm text-brand-text-secondary">La clave quedará ligada a tu usuario y sus permisos.</p></div><button type="button" class="api-modal-close" aria-label="Cerrar" @click="showCreate = false">×</button></header><div class="api-modal-body"><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Nombre de la clave<input v-model="form.name" required maxlength="100" placeholder="Integración de inventario" class="rounded border border-brand-border px-3 py-2 text-sm font-normal" /></label><label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Expira <span class="text-xs font-normal text-brand-text-muted">Opcional</span><input v-model="form.expiresAt" :min="new Date().toISOString().slice(0,10)" type="date" class="rounded border border-brand-border px-3 py-2 text-sm font-normal" /></label><div><p class="mb-2 text-[13px] font-semibold text-brand-text">Permisos por módulo</p><div class="flex flex-col gap-2"><div v-for="entity in entityResponse?.entities || []" :key="entity.id" class="rounded border border-brand-border-light p-3"><p class="mb-2 text-xs font-semibold text-brand-text">{{ entity.name }}</p><div class="flex flex-wrap gap-3 text-xs text-brand-text-secondary"><label v-for="action in scopeActions" :key="action.key" class="flex items-center gap-1"><input v-model="scopes[entity.slug][action.key]" :disabled="!entity[action.key]" type="checkbox" />{{ action.label }}</label></div></div></div></div><p v-if="error" class="text-xs text-brand-error-text">{{ error }}</p></div><footer class="api-modal-footer"><button type="button" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text" @click="showCreate = false">Cancelar</button><button type="submit" class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" :disabled="saving">{{ saving ? 'Generando...' : 'Generar API key' }}</button></footer></form></div></Teleport>
  <div v-if="showToken" class="fixed inset-0 z-50 flex items-center justify-center bg-[#1D293980] p-4"><div class="w-full max-w-lg rounded-lg bg-brand-surface shadow-xl"><div class="border-b border-brand-border-light p-5"><h2 class="text-base font-bold text-brand-text">API key creada</h2><p class="mt-1 text-sm text-brand-text-secondary">Copia esta clave ahora. No volveremos a mostrarla completa.</p></div><div class="p-5"><code class="block break-all rounded border border-brand-border-light bg-brand-bg p-3 text-xs text-brand-text">{{ token }}</code><button type="button" class="mt-3 flex items-center gap-1.5 rounded border border-brand-border px-3 py-2 text-xs font-semibold text-brand-text" @click="copyToken"><Copy class="h-3.5 w-3.5" />Copiar clave</button></div><div class="flex justify-end border-t border-brand-border-light p-5"><button type="button" class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white" @click="showToken = false; token = ''">Cerrar</button></div></div></div>
</template>
<style scoped>
.api-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgb(29 41 59 / 52%);
  margin: 0;
  box-sizing: border-box;
  isolation: isolate;
}
.api-modal {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(100%, 560px);
  max-height: calc(100vh - 48px);
  overflow: hidden;
  border: 1px solid #CBD6E2;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 18px 45px rgb(29 41 59 / 24%);
}
.api-modal-header,
.api-modal-footer { flex-shrink: 0; background: #fff; }
.api-modal-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 20px; border-bottom: 1px solid #E5EAF0; }
.api-modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 20px; border-top: 1px solid #E5EAF0; }
.api-modal-body { min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding: 20px; overscroll-behavior: contain; }
.api-modal-close { width: 28px; height: 28px; color: #516F90; font-size: 24px; line-height: 1; border-radius: 5px; }
.api-modal-close:hover { background: #F5F8FA; color: #33475B; }
@media (max-width: 640px) {
  .api-modal-overlay { align-items: flex-end; padding: 12px; }
  .api-modal { max-height: calc(100vh - 24px); }
}
</style>
