<script setup lang="ts">
import { Check, Copy, ExternalLink } from '@lucide/vue'
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
  if (field.dataType === 'user') return field.validationRules?.multiple === true ? ['uuid-del-usuario'] : 'uuid-del-usuario'
  return `valor de ${field.label || field.name}`
}

const fieldExample = computed(() => Object.fromEntries(availableFields.value.slice(0, 3).map((field) => [field.name, exampleValue(field)])))
const snippets = computed(() => ({
  list: `curl '${collectionUrl.value}?page=1&pageSize=20' \\\n  -H 'Authorization: Bearer <TU_API_KEY>'`,
  get: `curl '${itemUrl.value}' \\\n  -H 'Authorization: Bearer <TU_API_KEY>'`,
  create: `curl -X POST '${collectionUrl.value}' \\\n  -H 'Authorization: Bearer <TU_API_KEY>' \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify({ customData: fieldExample.value }, null, 2)}'`,
  update: `curl -X PUT '${itemUrl.value}' \\\n  -H 'Authorization: Bearer <TU_API_KEY>' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"customData": {"campo": "nuevo valor"}}'`,
  delete: `curl -X DELETE '${itemUrl.value}' \\\n  -H 'Authorization: Bearer <TU_API_KEY>'`
}))
const examples = [
  { key: 'list', method: 'GET', title: 'Listar registros' },
  { key: 'get', method: 'GET', title: 'Consultar un registro' },
  { key: 'create', method: 'POST', title: 'Crear un registro' },
  { key: 'update', method: 'PUT', title: 'Actualizar un registro' },
  { key: 'delete', method: 'DELETE', title: 'Eliminar un registro' }
] as const
const activeExample = ref<(typeof examples)[number]['key']>('list')

async function copyEndpointUrl() {
  await navigator.clipboard.writeText(collectionUrl.value)
  toast.success('URL copiada', 'Pégala en tu integración.')
}

async function copySnippet(key: keyof typeof snippets.value) {
  await navigator.clipboard.writeText(snippets.value[key])
  copied.value = key
  toast.success('Ejemplo copiado', 'Pégalo en tu integración.')
  window.setTimeout(() => { if (copied.value === key) copied.value = '' }, 1800)
}
</script>

<template>
  <section class="flex min-w-0 flex-col gap-[18px]">
    <header class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex flex-col gap-1">
        <h2 class="text-[21px] font-bold text-brand-text">API del módulo</h2>
        <p class="text-[13px] text-brand-text-secondary">Integra {{ entityName }} con los endpoints disponibles y sus campos actuales.</p>
      </div>
      <a :href="collectionUrl" target="_blank" rel="noreferrer" class="flex items-center gap-1.5 rounded border border-brand-border bg-brand-surface px-3 py-[9px] text-xs font-bold text-brand-blue hover:bg-brand-bg">Abrir endpoint <ExternalLink class="h-3.5 w-3.5" /></a>
    </header>

    <div class="grid min-w-0 gap-4 lg:grid-cols-2">
      <div class="min-w-0 rounded-lg border border-brand-border-light bg-brand-surface px-[18px] py-[15px]">
        <p class="text-[10px] font-bold uppercase tracking-wide text-brand-text-muted">Endpoint del módulo</p>
        <div class="mt-2 flex min-w-0 items-center justify-between gap-3">
          <code class="min-w-0 break-all text-[13px] font-semibold text-brand-text">{{ collectionUrl }}</code>
          <button type="button" class="shrink-0 text-[11px] font-bold text-brand-blue hover:underline" @click="copyEndpointUrl">Copiar</button>
        </div>
      </div>
      <div class="min-w-0 rounded-lg border border-brand-border-light bg-brand-surface px-[18px] py-[15px]">
        <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="text-xs font-bold text-brand-text">Autenticación Bearer</h3><NuxtLink to="/ajustes#api-keys" class="text-[11px] font-bold text-brand-blue hover:underline">Administrar API keys ↗</NuxtLink></div>
        <code class="mt-2 block break-all text-xs text-brand-text-secondary">Authorization: Bearer &lt;TU_API_KEY&gt;</code>
      </div>
    </div>

    <div class="grid min-w-0 gap-5 lg:grid-cols-[410px_minmax(0,1fr)]">
      <section class="min-w-0 rounded-lg border border-brand-border-light bg-brand-surface p-4">
        <h3 class="text-[15px] font-bold text-brand-text">Operaciones</h3>
        <p class="mb-3 mt-1 text-xs text-brand-text-secondary">Selecciona una ruta para ver su solicitud.</p>
        <div class="flex flex-col gap-2">
          <button v-for="example in examples" :key="example.key" type="button" class="flex h-[54px] w-full items-center gap-3 rounded-md border px-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue" :class="activeExample === example.key ? 'border-brand-blue bg-brand-blue-bg' : 'border-brand-border-light bg-brand-surface hover:bg-brand-bg'" :aria-pressed="activeExample === example.key" @click="activeExample = example.key">
            <span class="rounded px-2 py-1 text-[10px] font-bold" :class="example.method === 'DELETE' ? 'bg-brand-error-bg text-brand-error-text' : example.method === 'GET' ? 'bg-brand-blue-bg text-brand-blue' : 'bg-brand-success-bg text-brand-success-text'">{{ example.method }}</span>
            <span class="text-xs font-semibold text-brand-text">{{ example.title }}</span>
          </button>
        </div>
      </section>
      <section class="min-w-0 overflow-hidden rounded-lg border border-brand-border-light bg-brand-surface">
        <div class="flex min-h-[55px] flex-wrap items-center justify-between gap-2 border-b border-brand-border-light px-[18px] py-2.5">
          <h3 class="text-sm font-bold text-brand-text">Ejemplo de solicitud</h3>
          <button type="button" class="flex items-center gap-1.5 rounded bg-brand-bg px-2.5 py-1.5 text-xs font-semibold text-brand-text hover:bg-brand-blue-bg" @click="copySnippet(activeExample)"><Check v-if="copied === activeExample" class="h-3.5 w-3.5 text-brand-success-text" /><Copy v-else class="h-3.5 w-3.5" />{{ copied === activeExample ? 'Copiado' : 'Copiar' }}</button>
        </div>
        <div class="flex flex-col gap-3 p-[18px]">
          <p class="text-xs text-brand-text-secondary">{{ examples.find(example => example.key === activeExample)?.title }} en {{ entityName }}.</p>
          <pre class="min-w-0 overflow-x-auto rounded-md bg-[#172B4D] p-4 text-[11px] leading-5 text-[#D9E7F5]"><code>{{ snippets[activeExample] }}</code></pre>
          <p class="text-[11px] text-brand-text-muted">Sustituye &lt;TU_API_KEY&gt; y {id} por tus valores antes de ejecutar.</p>
        </div>
      </section>
    </div>

    <section class="min-w-0 overflow-hidden rounded-lg border border-brand-border-light bg-brand-surface">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-brand-border-light px-[18px] py-[15px]">
        <div><h3 class="text-[15px] font-bold text-brand-text">Campos disponibles</h3><p class="mt-1 text-xs text-brand-text-secondary">Los datos se envían en <code>customData</code>; Flow genera el id.</p></div>
        <span class="text-[11px] font-bold text-brand-blue">{{ fields.length }} campos</span>
      </div>
      <div class="overflow-x-auto"><table class="w-full min-w-[560px] text-left text-xs">
        <thead class="bg-brand-bg text-[11px] text-brand-text-muted"><tr><th class="px-[18px] py-3 font-bold">CAMPO / CLAVE</th><th class="px-[18px] py-3 font-bold">TIPO DE DATO</th><th class="px-[18px] py-3 font-bold">REQUERIDO</th></tr></thead>
        <tbody><tr v-for="field in fields" :key="field.id" class="border-t border-brand-border-light even:bg-brand-bg"><td class="px-[18px] py-2.5"><div class="font-semibold text-brand-text">{{ field.label }}</div><code class="text-[11px] text-brand-text-muted">{{ field.name }}</code></td><td class="px-[18px] py-2.5 text-brand-text-secondary">{{ field.dataType }}</td><td class="px-[18px] py-2.5" :class="field.name === 'id' || field.isRequired ? 'font-bold text-brand-success-text' : 'text-brand-text-muted'">{{ field.name === 'id' || field.isRequired ? 'Sí' : 'No' }}</td></tr></tbody>
      </table></div>
    </section>

    <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-border-light bg-brand-surface px-[18px] py-3.5">
      <div><p class="text-[13px] font-bold text-brand-text">Permisos de tu usuario</p><p class="mt-1 text-[11px] text-brand-text-secondary">Las operaciones disponibles dependen de los permisos asignados.</p></div>
      <div class="flex flex-wrap gap-2"><span v-for="permission in [{ key: 'canRead', label: 'Leer' }, { key: 'canCreate', label: 'Crear' }, { key: 'canUpdate', label: 'Actualizar' }, { key: 'canDelete', label: 'Eliminar' }]" :key="permission.key" class="rounded px-2.5 py-1 text-[11px] font-bold" :class="permissions?.[permission.key as keyof EntityPermissions] ? 'bg-brand-success-bg text-brand-success-text' : 'bg-brand-bg text-brand-text-muted'">{{ permission.label }}{{ permissions?.[permission.key as keyof EntityPermissions] ? '' : ' · sin acceso' }}</span></div>
    </div>
  </section>
</template>
