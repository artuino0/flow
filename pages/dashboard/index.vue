<script setup lang="ts">
// HU-ERD-34: dashboard interno OLAP - consume GET /api/dashboard/metrics
// (HU-ERD-31). "Filtrable por tenant si aplica" (criterio de aceptacion): no
// aplica tal como esta disenado el endpoint - el tenant sale siempre del JWT
// autenticado, no hay un query param para elegir tenant (ver la decision de
// alcance documentada en HU-ERD-31/DOCS/Esquema_OLAP.md: el sistema no tiene
// un concepto de admin global/staff). Lo que si es filtrable, y esta pantalla
// expone, es el rango de fechas y el tipo de evento.
definePageMeta({ layout: 'default' })

interface EventoPorTipo {
  tipoEvento: string
  total: number
  monto: string
}

interface DashboardMetrics {
  tenantId: string
  rango: { from: number; to: number }
  eventos: { total: number; montoTotal: string; cantidadTotal: number; porTipo: EventoPorTipo[] }
  clientes: { total: number }
  sucursales: { total: number }
  usuarios: { total: number; activos: number }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

const from = ref(isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)))
const to = ref(isoDate(new Date()))
const tipoEvento = ref('')

// HU-ERD-35: FEATURE_DASHBOARD=false lo apaga de punta a punta - ni siquiera
// se intenta el fetch (que igual daria 404, ver server/api/dashboard/metrics.get.ts).
// GET /api/config, no useRuntimeConfig() - ver composables/useDeploymentConfig.ts.
const { data: appConfig } = await useDeploymentConfig()
const dashboardEnabled = appConfig.value?.featureFlags.dashboard ?? true

// HU-ERD-32: forwarding manual de la cookie en SSR (ver useEntityFields.ts).
const { data, pending, error: fetchError, refresh } = await useFetch<DashboardMetrics>('/api/dashboard/metrics', {
  key: 'dashboard-metrics',
  query: computed(() => ({ from: from.value, to: to.value, tipoEvento: tipoEvento.value || undefined })),
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  immediate: dashboardEnabled
})

const maxMonto = computed(() => {
  const montos = (data.value?.eventos.porTipo ?? []).map((p) => Number(p.monto))
  return montos.length ? Math.max(...montos, 1) : 1
})

function barWidthPct(monto: string): number {
  return Math.max(2, Math.round((Number(monto) / maxMonto.value) * 100))
}

function formatMonto(monto: string): string {
  return Number(monto).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <h1 class="text-lg font-semibold text-gray-900">Dashboard</h1>

    <form class="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4" @submit.prevent="refresh()">
      <div class="flex flex-col gap-1">
        <label for="dashboard-from" class="text-xs font-medium text-gray-600">Desde</label>
        <input id="dashboard-from" v-model="from" type="date" class="rounded border border-gray-300 px-2 py-1 text-sm" />
      </div>
      <div class="flex flex-col gap-1">
        <label for="dashboard-to" class="text-xs font-medium text-gray-600">Hasta</label>
        <input id="dashboard-to" v-model="to" type="date" class="rounded border border-gray-300 px-2 py-1 text-sm" />
      </div>
      <div class="flex flex-col gap-1">
        <label for="dashboard-tipo" class="text-xs font-medium text-gray-600">Tipo de evento (opcional)</label>
        <input
          id="dashboard-tipo"
          v-model="tipoEvento"
          type="text"
          placeholder="ej. clientes"
          class="rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </div>
      <button type="submit" class="rounded bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
        Aplicar
      </button>
    </form>

    <p v-if="!dashboardEnabled" class="text-sm text-gray-500">Esta funcionalidad esta deshabilitada.</p>
    <p v-else-if="pending" class="text-sm text-gray-500">Cargando...</p>
    <p v-else-if="fetchError" class="text-sm text-red-600">
      No se pudieron cargar las metricas{{ fetchError.statusCode === 403 ? ' (requiere rol administrador)' : '' }}.
    </p>

    <template v-else-if="data">
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Eventos</p>
          <p class="mt-1 text-2xl font-semibold text-gray-900">{{ data.eventos.total }}</p>
          <p class="text-xs text-gray-500">{{ formatMonto(data.eventos.montoTotal) }}</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Clientes</p>
          <p class="mt-1 text-2xl font-semibold text-gray-900">{{ data.clientes.total }}</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Sucursales</p>
          <p class="mt-1 text-2xl font-semibold text-gray-900">{{ data.sucursales.total }}</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-xs font-medium uppercase tracking-wide text-gray-500">Usuarios activos</p>
          <p class="mt-1 text-2xl font-semibold text-gray-900">{{ data.usuarios.activos }} / {{ data.usuarios.total }}</p>
        </div>
      </div>

      <div v-if="data.eventos.porTipo.length === 0" class="text-sm text-gray-500">
        No hay eventos registrados en el rango seleccionado.
      </div>

      <template v-else>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="mb-3 text-sm font-medium text-gray-700">Monto por tipo de evento</p>
          <div class="flex flex-col gap-2">
            <div v-for="row in data.eventos.porTipo" :key="row.tipoEvento" class="flex items-center gap-2">
              <span class="w-28 shrink-0 text-xs text-gray-600">{{ row.tipoEvento }}</span>
              <div class="h-4 flex-1 rounded bg-gray-100">
                <div class="h-4 rounded bg-primary-500" :style="{ width: `${barWidthPct(row.monto)}%` }"></div>
              </div>
              <span class="w-24 shrink-0 text-right text-xs text-gray-600">{{ formatMonto(row.monto) }}</span>
            </div>
          </div>
        </div>

        <div class="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table class="min-w-full divide-y divide-gray-200 text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-2 text-left font-medium text-gray-600">Tipo de evento</th>
                <th class="px-4 py-2 text-right font-medium text-gray-600">Eventos</th>
                <th class="px-4 py-2 text-right font-medium text-gray-600">Monto</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr v-for="row in data.eventos.porTipo" :key="row.tipoEvento">
                <td class="px-4 py-2 text-gray-900">{{ row.tipoEvento }}</td>
                <td class="px-4 py-2 text-right text-gray-700">{{ row.total }}</td>
                <td class="px-4 py-2 text-right text-gray-700">{{ formatMonto(row.monto) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </div>
</template>
