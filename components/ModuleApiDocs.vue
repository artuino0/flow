<script setup lang="ts">
import { BookOpen, Check, Copy, ExternalLink, KeyRound } from '@lucide/vue'
import type { EntityFieldMeta, EntityPermissions } from '~/composables/useEntityFields'

const props = defineProps<{ entityName: string; entitySlug: string; fields: EntityFieldMeta[]; permissions?: EntityPermissions }>()
const toast = useToast()
const copied = ref('')
const requestUrl = useRequestURL()
const baseUrl = computed(() => `${requestUrl.origin}/api`)
const collectionUrl = computed(() => `${baseUrl.value}/records/${props.entitySlug}`)
const itemUrl = computed(() => `${collectionUrl.value}/{id}`)
const availableFields = computed(() => props.fields.filter((field) => field.name !== 'id'))

function exampleValue(field: EntityFieldMeta) {
  if (field.dataType === 'boolean') return true
  if (['number', 'integer', 'decimal'].includes(field.dataType)) return 0
  if (field.dataType === 'currency') return '1250.00'
  if (field.dataType === 'date' || field.dataType === 'datetime') return '2026-09-13'
  if (field.dataType === 'select') return 'opcion'
  if (field.dataType === 'multiselect') return ['opcion']
  if (field.dataType === 'relation') return 'uuid-del-registro-relacionado'
  return `valor de ${field.label || field.name}`
}

const fieldExample = computed(() => Object.fromEntries(availableFields.value.slice(0, 3).map((field) => [field.name, exampleValue(field)])))
const snippets = computed(() => ({
  list: `curl '${collectionUrl.value}?page=1&pageSize=20' \\\n+  -H 'Authorization: Bearer <TU_API_KEY>'`,
  get: `curl '${itemUrl.value}' \\\n+  -H 'Authorization: Bearer <TU_API_KEY>'`,
  create: `curl -X POST '${collectionUrl.value}' \\\n+  -H 'Authorization: Bearer <TU_API_KEY>' \\\n+  -H 'Content-Type: application/json' \\\n+  -d '${JSON.stringify({ customData: fieldExample.value }, null, 2)}'`,
  update: `curl -X PUT '${itemUrl.value}' \\\n+  -H 'Authorization: Bearer <TU_API_KEY>' \\\n+  -H 'Content-Type: application/json' \\\n+  -d '{"customData": {"campo": "nuevo valor"}}'`,
  delete: `curl -X DELETE '${itemUrl.value}' \\\n+  -H 'Authorization: Bearer <TU_API_KEY>'`
}))
const examples = [
  { key: 'list', method: 'GET', title: 'Listar registros' },
  { key: 'get', method: 'GET', title: 'Consultar un registro' },
  { key: 'create', method: 'POST', title: 'Crear un registro' },
  { key: 'update', method: 'PUT', title: 'Actualizar un registro' },
  { key: 'delete', method: 'DELETE', title: 'Eliminar un registro' }
] as const

async function copySnippet(key: keyof typeof snippets.value) {
  await navigator.clipboard.writeText(snippets.value[key])
  copied.value = key
  toast.success('Ejemplo copiado', 'Pégalo en tu integración.')
  window.setTimeout(() => { if (copied.value === key) copied.value = '' }, 1800)
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex items-start justify-between gap-4">
      <div><div class="flex items-center gap-2"><BookOpen class="h-5 w-5 text-brand-blue" :stroke-width="1.8" /><h2 class="text-[17px] font-bold text-brand-text">Documentación de API</h2></div><p class="mt-1 text-sm text-brand-text-secondary">Consulta e integra <strong>{{ entityName }}</strong> usando sus endpoints CRUD.</p></div>
      <a :href="collectionUrl" target="_blank" rel="noreferrer" class="hidden items-center gap-1.5 rounded border border-brand-border px-3 py-2 text-xs font-semibold text-brand-text hover:bg-brand-bg sm:flex">Abrir endpoint <ExternalLink class="h-3.5 w-3.5" /></a>
    </div>

    <div class="rounded-lg border border-brand-blue/20 bg-brand-blue-bg p-4"><div class="flex items-start gap-3"><span class="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white"><KeyRound class="h-4 w-4 text-brand-blue" /></span><div class="min-w-0"><p class="text-sm font-bold text-brand-text">Autenticación</p><p class="mt-0.5 text-xs text-brand-text-secondary">Envía tu API key en cada solicitud usando el encabezado Bearer.</p><code class="mt-2 block break-all rounded border border-brand-border-light bg-white px-3 py-2 text-xs text-brand-text">Authorization: Bearer &lt;TU_API_KEY&gt;</code><NuxtLink to="/ajustes#api-keys" class="mt-2 inline-block text-xs font-semibold text-brand-blue hover:underline">Administrar API keys →</NuxtLink></div></div></div>

    <div class="grid gap-4 md:grid-cols-2"><div class="rounded-lg border border-brand-border-light bg-brand-surface p-4"><p class="text-xs font-bold uppercase tracking-wide text-brand-text-muted">URL base</p><code class="mt-2 block break-all rounded bg-brand-bg px-3 py-2 text-xs text-brand-text">{{ baseUrl }}</code><p class="mt-2 text-xs text-brand-text-muted">Ruta del módulo: <code>/records/{{ entitySlug }}</code></p></div><div class="rounded-lg border border-brand-border-light bg-brand-surface p-4"><p class="text-xs font-bold uppercase tracking-wide text-brand-text-muted">Permisos de tu usuario</p><div class="mt-3 flex flex-wrap gap-2 text-xs"><span v-for="permission in [{ key: 'canRead', label: 'Leer' }, { key: 'canCreate', label: 'Crear' }, { key: 'canUpdate', label: 'Actualizar' }, { key: 'canDelete', label: 'Eliminar' }]" :key="permission.key" class="rounded-full px-2.5 py-1 font-semibold" :class="permissions?.[permission.key as keyof EntityPermissions] ? 'bg-brand-success-bg text-brand-success-text' : 'bg-brand-bg text-brand-text-muted'">{{ permission.label }}{{ permissions?.[permission.key as keyof EntityPermissions] ? '' : ' · sin acceso' }}</span></div></div></div>

    <section class="rounded-lg border border-brand-border-light bg-brand-surface"><div class="border-b border-brand-border-light p-4"><h3 class="text-sm font-bold text-brand-text">Campos disponibles</h3><p class="mt-0.5 text-xs text-brand-text-muted">Se envían dentro de <code>customData</code>. El <code>id</code> lo genera Flow.</p></div><div class="overflow-x-auto"><table class="w-full text-left text-xs"><thead><tr class="border-b border-brand-border-light text-brand-text-muted"><th class="p-3 font-semibold">Campo</th><th class="p-3 font-semibold">Tipo</th><th class="p-3 font-semibold">Requerido</th></tr></thead><tbody><tr v-for="field in fields" :key="field.id" class="border-b border-brand-border-light last:border-0"><td class="p-3"><div class="font-semibold text-brand-text">{{ field.label }}</div><code class="text-[11px] text-brand-text-muted">{{ field.name }}</code></td><td class="p-3 text-brand-text-secondary">{{ field.dataType }}</td><td class="p-3">{{ field.name === 'id' || field.isRequired ? 'Sí' : 'No' }}</td></tr></tbody></table></div></section>

    <section class="flex flex-col gap-3"><div><h3 class="text-sm font-bold text-brand-text">Ejemplos</h3><p class="mt-0.5 text-xs text-brand-text-muted">Reemplaza <code>&lt;TU_API_KEY&gt;</code> y <code>{id}</code> con tus valores.</p></div><div v-for="example in examples" :key="example.key" class="overflow-hidden rounded-lg border border-brand-border-light bg-[#172B4D]"><div class="flex items-center justify-between border-b border-white/10 px-4 py-2.5"><div class="flex items-center gap-2"><span class="rounded bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white">{{ example.method }}</span><span class="text-xs font-semibold text-white">{{ example.title }}</span></div><button type="button" class="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white" @click="copySnippet(example.key)"><Check v-if="copied === example.key" class="h-3.5 w-3.5 text-emerald-300" /><Copy v-else class="h-3.5 w-3.5" />{{ copied === example.key ? 'Copiado' : 'Copiar' }}</button></div><pre class="overflow-x-auto p-4 text-[11px] leading-5 text-[#D9E7F5]"><code>{{ snippets[example.key] }}</code></pre></div></section>
  </div>
</template>
