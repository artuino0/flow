<script setup lang="ts">
// HU-ERD-34 (dashboard interno OLAP) + reubicacion post-HU-ERD-67: la home
// (/) solia ser un placeholder vacio de HU-ERD-21 ("Inicio") separado del
// dashboard real en /dashboard - el usuario señalo que no tenia sentido tener
// dos pantallas de aterrizaje distintas, una vacia y otra con contenido real.
// Se fusionaron en una sola: esta pagina, renombrada "Tablero", visible en la
// seccion General del menu para CUALQUIER usuario autenticado (dejo de ser
// exclusiva de administrador - ver requireAuth en server/api/dashboard/metrics.get.ts).
// pages/dashboard/index.vue (y su ruta /dashboard) se eliminaron.
//
// Diseno Pencil: Cards con icon box (estilo Screen/Dashboard del .pen)
// aplicadas a las metricas reales de esta HU (eventos/clientes/sucursales/
// usuarios) - la pantalla disenada mostraba placeholders de otro dominio
// (Facturas/Pedidos/Proveedores, entidades que no existen en este proyecto),
// asi que se sigue el look, no el contenido literal del mock.
import { CalendarDays, Users, Building2, UserCheck } from '@lucide/vue'

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
  <div class="flex flex-col gap-5">
    <h1 class="text-[22px] font-bold text-brand-text">Tablero</h1>

    <form
      class="flex flex-wrap items-end gap-3 rounded-lg border border-brand-border-light bg-brand-surface p-4 shadow-[0_1px_3px_0_#33475B14]"
      @submit.prevent="refresh()"
    >
      <div class="flex flex-col gap-1">
        <label for="dashboard-from" class="text-xs font-semibold text-brand-text-secondary">Desde</label>
        <input id="dashboard-from" v-model="from" type="date" class="rounded border border-brand-border px-2 py-1.5 text-sm text-brand-text focus:border-brand-blue focus:outline-none" />
      </div>
      <div class="flex flex-col gap-1">
        <label for="dashboard-to" class="text-xs font-semibold text-brand-text-secondary">Hasta</label>
        <input id="dashboard-to" v-model="to" type="date" class="rounded border border-brand-border px-2 py-1.5 text-sm text-brand-text focus:border-brand-blue focus:outline-none" />
      </div>
      <div class="flex flex-col gap-1">
        <label for="dashboard-tipo" class="text-xs font-semibold text-brand-text-secondary">Tipo de evento (opcional)</label>
        <input
          id="dashboard-tipo"
          v-model="tipoEvento"
          type="text"
          placeholder="ej. clientes"
          class="rounded border border-brand-border px-2 py-1.5 text-sm text-brand-text placeholder:text-brand-text-muted focus:border-brand-blue focus:outline-none"
        />
      </div>
      <button type="submit" class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover">
        Aplicar
      </button>
    </form>

    <p v-if="!dashboardEnabled" class="text-sm text-brand-text-muted">Esta funcionalidad esta deshabilitada.</p>
    <p v-else-if="pending" class="text-sm text-brand-text-muted">Cargando...</p>
    <p v-else-if="fetchError" class="text-sm text-brand-error-text">
      No se pudieron cargar las metricas.
    </p>

    <template v-else-if="data">
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div class="rounded-lg border border-brand-border-light bg-brand-surface p-5 shadow-[0_1px_3px_0_#33475B14]">
          <div class="flex items-center justify-between">
            <p class="text-[13px] font-semibold text-brand-text-secondary">Eventos</p>
            <div class="flex h-7 w-7 items-center justify-center rounded bg-brand-blue-bg">
              <CalendarDays class="h-[15px] w-[15px] text-brand-blue" :stroke-width="1.75" />
            </div>
          </div>
          <p class="mt-2 text-[26px] font-bold text-brand-text">{{ data.eventos.total }}</p>
          <p class="text-xs font-semibold text-brand-blue">{{ formatMonto(data.eventos.montoTotal) }}</p>
        </div>
        <div class="rounded-lg border border-brand-border-light bg-brand-surface p-5 shadow-[0_1px_3px_0_#33475B14]">
          <div class="flex items-center justify-between">
            <p class="text-[13px] font-semibold text-brand-text-secondary">Clientes</p>
            <div class="flex h-7 w-7 items-center justify-center rounded bg-brand-blue-bg">
              <Users class="h-[15px] w-[15px] text-brand-blue" :stroke-width="1.75" />
            </div>
          </div>
          <p class="mt-2 text-[26px] font-bold text-brand-text">{{ data.clientes.total }}</p>
        </div>
        <div class="rounded-lg border border-brand-border-light bg-brand-surface p-5 shadow-[0_1px_3px_0_#33475B14]">
          <div class="flex items-center justify-between">
            <p class="text-[13px] font-semibold text-brand-text-secondary">Sucursales</p>
            <div class="flex h-7 w-7 items-center justify-center rounded bg-brand-blue-bg">
              <Building2 class="h-[15px] w-[15px] text-brand-blue" :stroke-width="1.75" />
            </div>
          </div>
          <p class="mt-2 text-[26px] font-bold text-brand-text">{{ data.sucursales.total }}</p>
        </div>
        <div class="rounded-lg border border-brand-border-light bg-brand-surface p-5 shadow-[0_1px_3px_0_#33475B14]">
          <div class="flex items-center justify-between">
            <p class="text-[13px] font-semibold text-brand-text-secondary">Usuarios activos</p>
            <div class="flex h-7 w-7 items-center justify-center rounded bg-brand-blue-bg">
              <UserCheck class="h-[15px] w-[15px] text-brand-blue" :stroke-width="1.75" />
            </div>
          </div>
          <p class="mt-2 text-[26px] font-bold text-brand-text">{{ data.usuarios.activos }} / {{ data.usuarios.total }}</p>
        </div>
      </div>

      <div v-if="data.eventos.porTipo.length === 0" class="text-sm text-brand-text-muted">
        No hay eventos registrados en el rango seleccionado.
      </div>

      <template v-else>
        <div class="rounded-lg border border-brand-border-light bg-brand-surface p-5 shadow-[0_1px_3px_0_#33475B14]">
          <p class="mb-3 text-sm font-bold text-brand-text">Monto por tipo de evento</p>
          <div class="flex flex-col gap-2">
            <div v-for="row in data.eventos.porTipo" :key="row.tipoEvento" class="flex items-center gap-2">
              <span class="w-28 shrink-0 text-xs text-brand-text-secondary">{{ row.tipoEvento }}</span>
              <div class="h-4 flex-1 rounded bg-brand-bg">
                <div class="h-4 rounded bg-brand-blue" :style="{ width: `${barWidthPct(row.monto)}%` }"></div>
              </div>
              <span class="w-24 shrink-0 text-right text-xs text-brand-text-secondary">{{ formatMonto(row.monto) }}</span>
            </div>
          </div>
        </div>

        <div class="overflow-x-auto rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
          <table class="min-w-full text-sm">
            <thead class="border-b border-brand-border-light bg-brand-bg">
              <tr>
                <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">Tipo de evento</th>
                <th class="px-4 py-2.5 text-right text-[12px] font-bold tracking-wide text-brand-text-secondary">Eventos</th>
                <th class="px-4 py-2.5 text-right text-[12px] font-bold tracking-wide text-brand-text-secondary">Monto</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-brand-border-light">
              <tr v-for="row in data.eventos.porTipo" :key="row.tipoEvento">
                <td class="px-4 py-3 text-brand-text">{{ row.tipoEvento }}</td>
                <td class="px-4 py-3 text-right text-brand-text-secondary">{{ row.total }}</td>
                <td class="px-4 py-3 text-right text-brand-text-secondary">{{ formatMonto(row.monto) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </div>
</template>
