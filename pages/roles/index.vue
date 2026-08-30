<script setup lang="ts">
// HU-ERD-33: listado de roles del tenant (solo administradores, mismo guard
// que /api/roles: requireAdminRole). Cada fila lleva al editor de permisos
// (pages/roles/[id].vue).
definePageMeta({ layout: 'default' })

interface RoleRow {
  id: string
  name: string
  isSystem: boolean
}

// HU-ERD-32: forwarding manual de la cookie en SSR (ver useEntityFields.ts) -
// sin esto, un F5 en esta pantalla muestra el estado de error con la sesion
// activa.
const { data, pending, error: fetchError } = await useFetch<{ roles: RoleRow[] }>('/api/roles', {
  key: 'roles-list',
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <h1 class="text-lg font-semibold text-gray-900">Roles y permisos</h1>

    <p v-if="pending" class="text-sm text-gray-500">Cargando...</p>
    <p v-else-if="fetchError" class="text-sm text-red-600">
      No se pudo cargar el listado de roles{{ fetchError.statusCode === 403 ? ' (requiere rol administrador)' : '' }}.
    </p>

    <template v-else-if="data">
      <p v-if="data.roles.length === 0" class="text-sm text-gray-500">Este tenant todavia no tiene roles.</p>

      <div v-else class="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-2 text-left font-medium text-gray-600">Nombre</th>
              <th class="px-4 py-2 text-left font-medium text-gray-600">Tipo</th>
              <th class="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="role in data.roles" :key="role.id">
              <td class="px-4 py-2 text-gray-900">{{ role.name }}</td>
              <td class="px-4 py-2 text-gray-500">{{ role.isSystem ? 'Sistema (acceso total)' : 'Personalizado' }}</td>
              <td class="px-4 py-2 text-right">
                <NuxtLink :to="`/roles/${role.id}`" class="font-medium text-primary-700 hover:underline">
                  Editar permisos
                </NuxtLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
