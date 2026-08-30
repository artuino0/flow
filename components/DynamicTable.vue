<script setup lang="ts">
// HU-ERD-24: Table Builder dinamico - columnas derivadas de entity_fields,
// orden (click en encabezado) y paginacion, con acciones por fila segun RBAC
// (permissions viene de GET /api/entities/:entity/fields, HU-ERD-24 tambien).
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
}>()

const emit = defineEmits<{
  'update:page': [page: number]
  'update:sort': [value: { sortBy: string; sortDir: 'asc' | 'desc' }]
  delete: [id: string]
}>()

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))

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
      const d = new Date(v as string)
      return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString()
    }
    case 'json':
      return typeof v === 'string' ? v : JSON.stringify(v)
    default:
      return String(v)
  }
}

function onDelete(id: string) {
  if (confirm('Eliminar este registro? Esta accion no se puede deshacer.')) {
    emit('delete', id)
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table class="min-w-full divide-y divide-gray-200 text-sm">
        <thead class="bg-gray-50">
          <tr>
            <th
              v-for="field in fields"
              :key="field.id"
              class="cursor-pointer select-none whitespace-nowrap px-4 py-2 text-left font-medium text-gray-600 hover:text-gray-900"
              @click="toggleSort(field.name)"
            >
              {{ field.label }}
              <span v-if="sortBy === field.name" class="ml-1 text-primary-600">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
            </th>
            <th v-if="permissions.canUpdate || permissions.canDelete" class="px-4 py-2 text-right font-medium text-gray-600">
              Acciones
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-if="rows.length === 0">
            <td :colspan="fields.length + 1" class="px-4 py-6 text-center text-gray-500">Sin registros.</td>
          </tr>
          <tr v-for="row in rows" :key="row.id" class="hover:bg-gray-50">
            <td v-for="field in fields" :key="field.id" class="whitespace-nowrap px-4 py-2 text-gray-800">
              {{ cellValue(field, row) }}
            </td>
            <td v-if="permissions.canUpdate || permissions.canDelete" class="whitespace-nowrap px-4 py-2 text-right">
              <NuxtLink
                v-if="permissions.canUpdate"
                :to="`/registros/${entitySlug}/${row.id}/editar`"
                class="mr-3 text-primary-600 hover:underline"
              >
                Editar
              </NuxtLink>
              <button
                v-if="permissions.canDelete"
                type="button"
                class="text-red-600 hover:underline"
                @click="onDelete(row.id)"
              >
                Eliminar
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex items-center justify-between text-sm text-gray-600">
      <span>{{ total }} registro{{ total === 1 ? '' : 's' }} - pagina {{ page }} de {{ totalPages }}</span>
      <div class="flex gap-2">
        <button
          type="button"
          class="rounded border border-gray-300 px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="page <= 1"
          @click="emit('update:page', page - 1)"
        >
          Anterior
        </button>
        <button
          type="button"
          class="rounded border border-gray-300 px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="page >= totalPages"
          @click="emit('update:page', page + 1)"
        >
          Siguiente
        </button>
      </div>
    </div>
  </div>
</template>
