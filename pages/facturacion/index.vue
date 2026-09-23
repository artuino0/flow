<script setup lang="ts">
import { FileText, FileMinus, WalletCards, Plus, Hash, ChevronLeft, ChevronRight, Ban, CircleCheck } from '@lucide/vue'
import { ESTADOS_CFDI, TIPO_CFDI_LABEL, TIPOS_COMPROBANTE, formatoDinero, formatoFechaHora } from '~/utils/cfdiCatalogos'

// Fase C de DOCS/HU_Timbrado_CFDI_PAC.md: listado del dominio fiscal fijo.
// Solo admins de tenants MX llegan acá (nav oculta + endpoints 404 fuera de MX).
definePageMeta({ layout: 'default' })

interface DocRow {
  id: string
  folio: number | null
  tipo: string
  estado: string
  serie: string
  receptorNombre: string | null
  receptorRfc: string | null
  uuidFiscal: string | null
  fechaTimbrado: Date | string | null
  total: string
  moneda: string
  createdAt: Date | string
}
interface Serie {
  id: string
  serie: string
  tipoComprobante: string
  lugarExpedicion: string
  nextFolio: number
  estado: string
}

const toast = useToast()
const loading = ref(false)
const loadError = ref('')
const rows = ref<DocRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const filters = reactive({ tipo: '', estado: '', q: '' })

const series = ref<Serie[]>([])
const showSeries = ref(false)
const serieSaving = ref(false)
const nuevaSerie = reactive({ serie: '', tipoComprobante: 'I', lugarExpedicion: '' })

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const params: Record<string, string | number> = { page: page.value, pageSize }
    if (filters.tipo) params.tipo = filters.tipo
    if (filters.estado) params.estado = filters.estado
    if (filters.q.trim()) params.q = filters.q.trim()
    const data = await $fetch<{ rows: DocRow[]; total: number }>('/api/facturacion/documents', { params })
    rows.value = data.rows
    total.value = data.total
  } catch (err: any) {
    loadError.value = err?.statusCode === 404 || err?.statusCode === 403
      ? 'La facturación electrónica está disponible solo para administradores de organizaciones en México.'
      : err?.data?.statusMessage || 'No se pudo cargar el listado'
    rows.value = []
  } finally {
    loading.value = false
  }
}

async function loadSeries() {
  try {
    series.value = await $fetch<Serie[]>('/api/facturacion/series')
  } catch {
    series.value = []
  }
}

onMounted(() => {
  load()
  loadSeries()
})

watch([() => filters.tipo, () => filters.estado], () => {
  page.value = 1
  load()
})

function buscar() {
  page.value = 1
  load()
}

function cambiarPagina(delta: number) {
  const next = page.value + delta
  if (next < 1 || (next - 1) * pageSize >= total.value) return
  page.value = next
  load()
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

async function createSerie() {
  if (!nuevaSerie.serie.trim() || !/^\d{5}$/.test(nuevaSerie.lugarExpedicion)) {
    toast.error('Revisa la serie', 'La serie es obligatoria y el lugar de expedición es un CP de 5 dígitos.')
    return
  }
  serieSaving.value = true
  try {
    await $fetch('/api/facturacion/series', {
      method: 'POST',
      body: { serie: nuevaSerie.serie.trim(), tipoComprobante: nuevaSerie.tipoComprobante, lugarExpedicion: nuevaSerie.lugarExpedicion }
    })
    toast.success('Serie creada', `Serie "${nuevaSerie.serie.trim().toUpperCase()}" tipo ${nuevaSerie.tipoComprobante} lista para folios.`)
    nuevaSerie.serie = ''
    await loadSeries()
  } catch (err: any) {
    toast.error('No se pudo crear la serie', err?.data?.statusMessage || 'Intenta de nuevo')
  } finally {
    serieSaving.value = false
  }
}

async function toggleSerie(s: Serie) {
  try {
    await $fetch(`/api/facturacion/series/${s.id}`, { method: 'PUT', body: { estado: s.estado === 'activa' ? 'inactiva' : 'activa' } })
    await loadSeries()
  } catch (err: any) {
    toast.error('No se pudo cambiar la serie', err?.data?.statusMessage || 'Intenta de nuevo')
  }
}

function folioTexto(row: DocRow) {
  return row.folio != null ? `${row.serie}-${String(row.folio).padStart(6, '0')}` : `${row.serie}-borrador`
}
</script>

<template>
  <div class="min-h-[calc(100vh-120px)] pb-16">
    <ListPageHeader
      v-model:search="filters.q"
      title="Facturación electrónica"
      description="CFDI 4.0 timbrados con tu PAC, vinculados a tus cobros y operaciones."
      :count="total"
      count-noun="documento"
      search-placeholder="Buscar por receptor, RFC, UUID o folio..."
      :refreshing="loading"
      @refresh="load"
    >
      <template #actions>
        <button type="button" class="flex h-[35px] items-center rounded border border-brand-border bg-white px-3 text-[13px] font-semibold text-brand-text hover:bg-brand-bg" @click="showSeries = !showSeries">
          <span class="flex items-center gap-1.5"><Hash class="h-4 w-4" :stroke-width="1.75" />Series ({{ series.length }})</span>
        </button>
        <NuxtLink to="/facturacion/nuevo?tipo=P" class="flex h-[35px] items-center rounded border border-brand-border bg-white px-3 text-[13px] font-semibold text-brand-text hover:bg-brand-bg">
          <span class="flex items-center gap-1.5"><WalletCards class="h-4 w-4" :stroke-width="1.75" />Complemento de pago</span>
        </NuxtLink>
        <NuxtLink to="/facturacion/nuevo?tipo=E" class="flex h-[35px] items-center rounded border border-brand-border bg-white px-3 text-[13px] font-semibold text-brand-text hover:bg-brand-bg">
          <span class="flex items-center gap-1.5"><FileMinus class="h-4 w-4" :stroke-width="1.75" />Nota de crédito</span>
        </NuxtLink>
        <NuxtLink to="/facturacion/nuevo?tipo=I" class="flex h-[35px] items-center rounded bg-brand-orange px-3 text-[13px] font-semibold text-white hover:bg-brand-orange-hover">
          <span class="flex items-center gap-1.5"><Plus class="h-4 w-4" :stroke-width="2" />Nueva factura</span>
        </NuxtLink>
      </template>
      <template #toolbar-left>
        <select v-model="filters.tipo" class="h-[30px] rounded border border-brand-border bg-white px-3 text-[13px] focus:border-brand-blue focus:outline-none">
          <option value="">Todos los tipos</option>
          <option value="I">Facturas (I)</option>
          <option value="E">Notas de crédito (E)</option>
          <option value="P">Complementos (P)</option>
        </select>
        <select v-model="filters.estado" class="h-[30px] rounded border border-brand-border bg-white px-3 text-[13px] focus:border-brand-blue focus:outline-none">
          <option value="">Todos los estados</option>
          <option value="borrador">Borrador</option>
          <option value="timbrando">Timbrando</option>
          <option value="timbrada">Timbrada</option>
          <option value="error">Error</option>
          <option value="cancelada">Cancelada</option>
        </select>
        <button type="button" class="h-[30px] rounded border border-brand-border px-3 text-[13px] font-semibold text-brand-text-secondary hover:bg-brand-bg" @click="buscar">Buscar</button>
      </template>
    </ListPageHeader>

    <section v-if="showSeries" class="mt-5 rounded-lg border border-brand-border-light bg-white p-5">
      <h2 class="text-[15px] font-bold text-brand-text">Series fiscales</h2>
      <p class="mt-1 text-[13px] text-brand-text-secondary">El folio se consume al timbrar y nunca se reutiliza. Una serie con folios no se borra: se inactiva.</p>
      <div v-if="series.length" class="mt-4 overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-brand-border-light text-left text-xs uppercase tracking-wide text-brand-text-muted">
              <th class="px-2 py-2 font-semibold">Serie</th>
              <th class="px-2 py-2 font-semibold">Tipo</th>
              <th class="px-2 py-2 font-semibold">Lugar de expedición</th>
              <th class="px-2 py-2 font-semibold">Siguiente folio</th>
              <th class="px-2 py-2 font-semibold">Estado</th>
              <th class="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in series" :key="s.id" class="border-b border-brand-border-light last:border-0">
              <td class="px-2 py-2 font-semibold text-brand-text">{{ s.serie }}</td>
              <td class="px-2 py-2">{{ TIPO_CFDI_LABEL[s.tipoComprobante] ?? s.tipoComprobante }}</td>
              <td class="px-2 py-2">{{ s.lugarExpedicion }}</td>
              <td class="px-2 py-2 tabular-nums">{{ s.nextFolio }}</td>
              <td class="px-2 py-2">
                <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="s.estado === 'activa' ? 'bg-brand-success-bg text-brand-success-text' : 'bg-brand-bg text-brand-text-muted'">{{ s.estado === 'activa' ? 'Activa' : 'Inactiva' }}</span>
              </td>
              <td class="px-2 py-2 text-right">
                <button type="button" class="rounded border border-brand-border px-2 py-1 text-xs font-semibold text-brand-text-secondary hover:bg-brand-bg" @click="toggleSerie(s)">
                  <span class="flex items-center gap-1">
                    <component :is="s.estado === 'activa' ? Ban : CircleCheck" class="h-3.5 w-3.5" :stroke-width="1.75" />
                    {{ s.estado === 'activa' ? 'Inactivar' : 'Activar' }}
                  </span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <form class="mt-4 grid gap-3 border-t border-brand-border-light pt-4 sm:grid-cols-[120px_1fr_160px_auto] sm:items-end" @submit.prevent="createSerie">
        <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Serie
          <input v-model="nuevaSerie.serie" maxlength="25" placeholder="A" class="w-full rounded border border-brand-border px-3 py-2 text-sm font-normal uppercase focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
        </label>
        <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Tipo de comprobante
          <select v-model="nuevaSerie.tipoComprobante" class="w-full rounded border border-brand-border bg-white px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue">
            <option v-for="t in TIPOS_COMPROBANTE" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Lugar de expedición (CP)
          <input v-model="nuevaSerie.lugarExpedicion" maxlength="5" inputmode="numeric" placeholder="20110" class="w-full rounded border border-brand-border px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
        </label>
        <button type="submit" :disabled="serieSaving" class="rounded bg-brand-orange px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-orange-hover disabled:opacity-50">Crear serie</button>
      </form>
    </section>

    <section class="mt-5 rounded-lg border border-brand-border-light bg-white">

      <p v-if="loadError" role="alert" class="p-6 text-sm text-brand-error-text">{{ loadError }}</p>
      <p v-else-if="loading && !rows.length" role="status" class="p-6 text-sm text-brand-text-muted">Cargando documentos…</p>
      <p v-else-if="!rows.length" class="p-6 text-sm text-brand-text-secondary">
        Todavía no hay documentos fiscales. Crea tu primera serie y tu primera factura.
      </p>
      <table v-else class="w-full text-sm">
        <thead>
          <tr class="border-b border-brand-border-light text-left text-xs uppercase tracking-wide text-brand-text-muted">
            <th class="px-4 py-2.5 font-semibold">Folio</th>
            <th class="px-4 py-2.5 font-semibold">Tipo</th>
            <th class="px-4 py-2.5 font-semibold">Receptor</th>
            <th class="px-4 py-2.5 font-semibold">Total</th>
            <th class="px-4 py-2.5 font-semibold">Estado</th>
            <th class="px-4 py-2.5 font-semibold">Creado</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id" class="border-b border-brand-border-light last:border-0 hover:bg-brand-bg/60">
            <td class="px-4 py-2.5">
              <NuxtLink :to="`/facturacion/${row.id}`" class="flex items-center gap-1.5 font-semibold text-brand-blue hover:underline">
                <component :is="row.tipo === 'I' ? FileText : row.tipo === 'E' ? FileMinus : WalletCards" class="h-4 w-4 shrink-0" :stroke-width="1.75" />
                {{ folioTexto(row) }}
              </NuxtLink>
            </td>
            <td class="px-4 py-2.5 text-brand-text-secondary">{{ TIPO_CFDI_LABEL[row.tipo] ?? row.tipo }}</td>
            <td class="px-4 py-2.5">
              <span class="block text-brand-text">{{ row.receptorNombre || '—' }}</span>
              <span v-if="row.receptorRfc" class="block text-xs text-brand-text-muted">{{ row.receptorRfc }}</span>
            </td>
            <td class="px-4 py-2.5 tabular-nums">{{ formatoDinero(row.total, row.moneda) }}</td>
            <td class="px-4 py-2.5">
              <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="ESTADOS_CFDI[row.estado]?.badge ?? 'bg-brand-bg'">{{ ESTADOS_CFDI[row.estado]?.label ?? row.estado }}</span>
            </td>
            <td class="px-4 py-2.5 text-brand-text-secondary">{{ formatoFechaHora(row.createdAt) }}</td>
          </tr>
        </tbody>
      </table>

      <div v-if="total > pageSize" class="flex items-center justify-between border-t border-brand-border-light p-3 text-sm">
        <span class="text-brand-text-secondary">{{ total }} documentos · página {{ page }} de {{ totalPages }}</span>
        <span class="flex gap-1">
          <button type="button" class="rounded border border-brand-border p-1.5 disabled:opacity-40" :disabled="page <= 1" @click="cambiarPagina(-1)"><ChevronLeft class="h-4 w-4" /></button>
          <button type="button" class="rounded border border-brand-border p-1.5 disabled:opacity-40" :disabled="page >= totalPages" @click="cambiarPagina(1)"><ChevronRight class="h-4 w-4" /></button>
        </span>
      </div>
    </section>
  </div>
</template>
