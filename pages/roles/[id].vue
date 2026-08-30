<script setup lang="ts">
// HU-ERD-33: matriz de permisos (entidad x can_read/can_create/can_update/
// can_delete) de un rol. Guarda todo el conjunto de una vez via
// PUT /api/roles/:id/permissions (upsert server-side por entidad).
definePageMeta({ layout: 'default' })

interface EntityPermissionRow {
  entityId: string
  entitySlug: string
  entityName: string
  canRead: boolean
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
}

interface RolePermissionsResponse {
  role: { id: string; name: string; isSystem: boolean }
  permissions: EntityPermissionRow[]
}

const route = useRoute()
const roleId = route.params.id as string

// HU-ERD-32: forwarding manual de la cookie en SSR.
const { data, pending, error: fetchError } = await useFetch<RolePermissionsResponse>(`/api/roles/${roleId}/permissions`, {
  key: `role-permissions-${roleId}`,
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})

// Copia local editable - se resetea cada vez que llega/cambia `data` (carga
// inicial, o despues de guardar con exito, ver onSave).
const rows = ref<EntityPermissionRow[]>([])
watchEffect(() => {
  if (data.value) rows.value = data.value.permissions.map((p) => ({ ...p }))
})

const saving = ref(false)
const saveError = ref<string | null>(null)
const saved = ref(false)

async function onSave() {
  saveError.value = null
  saved.value = false
  saving.value = true
  try {
    const result = await $fetch<RolePermissionsResponse>(`/api/roles/${roleId}/permissions`, {
      method: 'PUT',
      body: { permissions: rows.value.map(({ entityId, canRead, canCreate, canUpdate, canDelete }) => ({ entityId, canRead, canCreate, canUpdate, canDelete })) }
    })
    rows.value = result.permissions.map((p) => ({ ...p }))
    saved.value = true
  } catch (err: any) {
    saveError.value = err?.data?.statusMessage || 'No se pudieron guardar los permisos'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h1 class="text-lg font-semibold text-gray-900">
        Permisos{{ data?.role?.name ? ` - ${data.role.name}` : '' }}
      </h1>
      <NuxtLink to="/roles" class="text-sm text-gray-600 hover:underline">Volver al listado</NuxtLink>
    </div>

    <p v-if="pending" class="text-sm text-gray-500">Cargando...</p>
    <p v-else-if="fetchError" class="text-sm text-red-600">
      No se pudo cargar este rol{{ fetchError.statusCode === 403 ? ' (requiere rol administrador)' : '' }}.
    </p>

    <template v-else-if="data">
      <p v-if="data.role.isSystem" class="text-sm text-gray-500">
        Este es el rol de sistema del tenant - sus permisos aca son independientes del acceso administrativo
        (Configuracion general, esta misma pantalla), que depende del rol en si, no de estos checkboxes.
      </p>

      <p v-if="rows.length === 0" class="text-sm text-gray-500">Este tenant todavia no tiene entidades configuradas.</p>

      <div v-else class="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-2 text-left font-medium text-gray-600">Entidad</th>
              <th class="px-4 py-2 text-center font-medium text-gray-600">Leer</th>
              <th class="px-4 py-2 text-center font-medium text-gray-600">Crear</th>
              <th class="px-4 py-2 text-center font-medium text-gray-600">Editar</th>
              <th class="px-4 py-2 text-center font-medium text-gray-600">Eliminar</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="row in rows" :key="row.entityId">
              <td class="px-4 py-2 text-gray-900">{{ row.entityName }}</td>
              <td class="px-4 py-2 text-center">
                <input v-model="row.canRead" type="checkbox" class="h-4 w-4" />
              </td>
              <td class="px-4 py-2 text-center">
                <input v-model="row.canCreate" type="checkbox" class="h-4 w-4" />
              </td>
              <td class="px-4 py-2 text-center">
                <input v-model="row.canUpdate" type="checkbox" class="h-4 w-4" />
              </td>
              <td class="px-4 py-2 text-center">
                <input v-model="row.canDelete" type="checkbox" class="h-4 w-4" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex items-center gap-3">
        <button
          type="button"
          :disabled="saving || rows.length === 0"
          class="rounded bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          @click="onSave"
        >
          {{ saving ? 'Guardando...' : 'Guardar permisos' }}
        </button>
        <p v-if="saveError" class="text-sm text-red-600">{{ saveError }}</p>
        <p v-if="saved" class="text-sm text-green-700">Permisos guardados correctamente.</p>
      </div>
    </template>
  </div>
</template>
