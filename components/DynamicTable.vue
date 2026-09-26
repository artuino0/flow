<script setup lang="ts">
// HU-ERD-24: Table Builder dinamico - columnas derivadas de entity_fields,
// orden (click en encabezado) y paginacion, con acciones por fila segun RBAC
// (permissions viene de GET /api/entities/:entity/fields, HU-ERD-24 tambien).
//
// Diseno Pencil: "Table Header Row" / "Table Row" / "Pagination Item"
// (Default/Active) del .pen, envueltos en un contenedor tipo Card.
import { Eye, Pencil, Trash2, ChevronLeft, ChevronRight } from '@lucide/vue'
import type { EntityFieldMeta, EntityPermissions } from '~/composables/useEntityFields'

interface RecordRow {
  id: string
  customData: Record<string, unknown>
}

const props = defineProps<{
  entitySlug: string
  fields: EntityFieldMeta[]
  rows: RecordRow[]
  page: number
  pageSize: number
  total: number
  sortBy: string
  sortDir: 'asc' | 'desc'
  permissions: EntityPermissions
  // Reportado por el usuario (2026-09-03): etiquetas ya resueltas para las
  // columnas de tipo relation (ver server/utils/relationLabels.ts) -
  // `{ [nombreDeCampo]: { [uuid]: etiqueta } }`, adjuntado por
  // GET /api/records/:entity como relationLabels. Opcional (default {})
  // para no romper ningun uso previo del componente que todavia no lo pasa.
  relationLabels?: Record<string, Record<string, string>>
  rounded?: boolean
  inset?: boolean
  borderless?: boolean
  actionsSticky?: boolean
}>()

const emit = defineEmits<{
  'update:page': [page: number]
  'update:sort': [value: { sortBy: string; sortDir: 'asc' | 'desc' }]
  delete: [id: string]
}>()

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))

// Ventana corta de paginas alrededor de la actual (estilo Pagination Item
// del diseno) - evita listar cientos de botones cuando total es grande.
const pageWindow = computed(() => {
  const span = 2
  const start = Math.max(1, props.page - span)
  const end = Math.min(totalPages.value, props.page + span)
  const out: number[] = []
  for (let p = start; p <= end; p++) out.push(p)
  return out
})

function toggleSort(fieldName: string) {
  if (props.sortBy === fieldName) {
    emit('update:sort', { sortBy: fieldName, sortDir: props.sortDir === 'asc' ? 'desc' : 'asc' })
  } else {
    emit('update:sort', { sortBy: fieldName, sortDir: 'asc' })
  }
}

function cellValue(field: EntityFieldMeta, row: RecordRow): string {
  const v = row.customData[field.name]
  if (v === null || v === undefined || v === '') return '-'
  switch (field.dataType) {
    case 'boolean':
      return v ? 'Si' : 'No'
    case 'date': {
      return formatDate(v as string)
    }
    case 'currency':
      return formatCurrencyValue(v, field.validationRules)
    case 'json':
      return typeof v === 'string' ? v : JSON.stringify(v)
    // HU-ERD-73: la celda muestra la etiqueta configurada (validationRules.options),
    // nunca el "value" tecnico crudo - si una opcion se borro despues, cae al
    // value crudo como mejor esfuerzo (dato huerfano, mismo criterio que
    // HU-ERD-67 con entity_fields borrados).
    case 'select':
    case 'multiselect': {
      const options = Array.isArray(field.validationRules?.options) ? (field.validationRules.options as Array<{ value: string; label: string }>) : []
      const labelFor = (value: string) => options.find((o) => o.value === value)?.label ?? value
      return Array.isArray(v) ? v.map(labelFor).join(', ') || '-' : labelFor(String(v))
    }
    // Reportado por el usuario (2026-09-03): antes caia al default (uuid
    // crudo) - usa la etiqueta ya resuelta server-side; si por lo que sea no
    // esta (registro relacionado borrado, etc.) cae al uuid truncado, nunca
    // al uuid completo.
    case 'relation':
      return (props.relationLabels?.[field.name]?.[String(v)]) ?? String(v).slice(0, 8)
    default:
      return String(v)
  }
}

const { confirm: confirmAction } = useConfirm()
async function onDelete(id: string) {
  if (await confirmAction({ title: 'Eliminar registro', message: '¿Eliminar este registro? Esta acción no se puede deshacer.', confirmLabel: 'Eliminar', destructive: true })) {
    emit('delete', id)
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      class="overflow-x-auto bg-brand-surface"
      :class="{
        'rounded-lg': rounded !== false,
        'border border-brand-border-light shadow-[0_1px_3px_0_#33475B14]': !borderless,
        'border-b border-brand-border-light': borderless
      }"
    >
      <table class="min-w-full text-sm">
        <thead class="border-b border-brand-border-light bg-brand-bg">
          <tr>
            <th
              v-for="field in fields"
              :key="field.id"
              class="cursor-pointer select-none whitespace-nowrap px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary hover:text-brand-text"
              @click="toggleSort(field.name)"
            >
              {{ field.label }}
              <span v-if="sortBy === field.name" class="ml-1 text-brand-blue">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
            </th>
            <th 
              class="px-4 py-2.5 text-center text-[12px] font-bold tracking-wide text-brand-text-secondary"
              :class="actionsSticky ? 'sticky right-0 z-10 bg-brand-bg shadow-[inset_1px_0_0_0_#e5e7eb]' : ''"
            >
              Acciones
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-brand-border-light">
          <tr v-if="rows.length === 0">
            <td :colspan="fields.length + 1" class="px-4 py-6 text-center text-sm text-brand-text-muted">Sin registros.</td>
          </tr>
          <tr v-for="row in rows" :key="row.id" class="bg-brand-surface hover:bg-brand-bg">
            <td v-for="field in fields" :key="field.id" class="whitespace-nowrap px-4 py-3 text-brand-text">
              {{ cellValue(field, row) }}
            </td>
            <td 
              class="whitespace-nowrap px-4 py-3"
              :class="actionsSticky ? 'sticky right-0 z-10 bg-inherit shadow-[inset_1px_0_0_0_#e5e7eb]' : ''"
            >
              <div class="flex justify-center gap-2">
                <!-- HU-ERD-74: ficha de solo lectura - siempre disponible
                     (ya se llegó a este listado con canRead), no depende de
                     canUpdate/canDelete como las otras dos acciones. -->
                <NuxtLink
                  :to="`/registros/${entitySlug}/${row.id}`"
                  title="Ver detalle"
                  class="flex h-8 w-8 items-center justify-center rounded border border-brand-border-light text-brand-text-secondary hover:bg-brand-bg"
                >
                  <Eye class="h-4 w-4" :stroke-width="1.75" />
                </NuxtLink>
                <NuxtLink
                  v-if="permissions.canUpdate"
                  :to="`/registros/${entitySlug}/${row.id}?mode=edit`"
                  title="Editar"
                  class="flex h-8 w-8 items-center justify-center rounded border border-brand-border-light text-brand-text-secondary hover:bg-brand-bg"
                >
                  <Pencil class="h-4 w-4" :stroke-width="1.75" />
                </NuxtLink>
                <button
                  v-if="permissions.canDelete"
                  type="button"
                  title="Eliminar"
                  class="flex h-8 w-8 items-center justify-center rounded border border-brand-border-light text-brand-error-text hover:bg-brand-error-bg"
                  @click="onDelete(row.id)"
                >
                  <Trash2 class="h-4 w-4" :stroke-width="1.75" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex items-center justify-between" :class="{ 'px-5 pb-4': inset }">
      <span class="text-[13px] text-brand-text-secondary">{{ total }} registro{{ total === 1 ? '' : 's' }} - página {{ page }} de {{ totalPages }}</span>
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded border border-brand-border-light text-brand-text-secondary disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="page <= 1"
          @click="emit('update:page', page - 1)"
        >
          <ChevronLeft class="h-[15px] w-[15px]" :stroke-width="2" />
        </button>
        <button
          v-for="p in pageWindow"
          :key="p"
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded text-[13px] font-semibold"
          :class="p === page ? 'bg-brand-orange text-white' : 'text-brand-text-secondary hover:bg-brand-bg'"
          @click="emit('update:page', p)"
        >
          {{ p }}
        </button>
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded border border-brand-border-light text-brand-text-secondary disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="page >= totalPages"
          @click="emit('update:page', page + 1)"
        >
          <ChevronRight class="h-[15px] w-[15px]" :stroke-width="2" />
        </button>
      </div>
    </div>
  </div>
</template>
