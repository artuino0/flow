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
  <div class="flex flex-col gap-5">
    <h1 class="text-[22px] font-bold text-brand-text">Roles y permisos</h1>

    <p v-if="pending" class="text-sm text-brand-text-muted">Cargando...</p>
    <p v-else-if="fetchError" class="text-sm text-brand-error-text">
      No se pudo cargar el listado de roles{{ fetchError.statusCode === 403 ? ' (requiere rol administrador)' : '' }}.
    </p>

    <template v-else-if="data">
      <p v-if="data.roles.length === 0" class="text-sm text-brand-text-muted">Este tenant todavia no tiene roles.</p>

      <div v-else class="overflow-x-auto rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
        <table class="min-w-full text-sm">
          <thead class="border-b border-brand-border-light bg-brand-bg">
            <tr>
              <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">Nombre</th>
              <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">Tipo</th>
              <th class="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-brand-border-light">
            <tr v-for="role in data.roles" :key="role.id" class="hover:bg-brand-bg">
              <td class="px-4 py-3 font-medium text-brand-text">{{ role.name }}</td>
              <td class="px-4 py-3">
                <span
                  class="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                  :class="role.isSystem ? 'bg-brand-blue-bg text-brand-blue' : 'bg-brand-neutral-bg text-brand-neutral-text'"
                >
                  {{ role.isSystem ? 'Sistema (acceso total)' : 'Personalizado' }}
                </span>
              </td>
              <td class="px-4 py-3 text-right">
                <NuxtLink :to="`/roles/${role.id}`" class="text-sm font-semibold text-brand-blue hover:underline">
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
