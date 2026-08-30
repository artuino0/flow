<script setup lang="ts">
// HU-ERD-21: placeholder estatico del menu lateral. HU-ERD-44 lo reemplaza
// por un listado dinamico armado desde GET /api/entities (ERD-43), filtrado
// por lo que el usuario puede leer (canRead por entidad).
//
// HU-ERD-32: mientras tanto, agrega los links del modulo CRM/Directorio
// Central (Clientes/Empresas/Empleados, HU-ERD-25) resolviendolos punto a
// punto contra GET /api/entities/:slug/fields (HU-ERD-23/24) - el mismo
// endpoint que ya usan las paginas genericas para permisos. Ese endpoint
// tira 403 si el rol no tiene canRead y 404 si la entidad no existe todavia
// para el tenant (ej. no se corrio scripts/seed.mjs) - en ambos casos el link
// simplemente no se muestra, en vez de llevar a una pantalla rota. Esto NO es
// el menu dinamico generico de HU-ERD-44 (esa es para CUALQUIER entidad); es
// especifico de las 3 entidades de este modulo.
interface CrmEntry {
  slug: string
  label: string
}

const CRM_ENTRIES: CrmEntry[] = [
  { slug: 'clientes', label: 'Clientes' },
  { slug: 'empresas', label: 'Empresas' },
  { slug: 'empleados', label: 'Empleados' }
]

const { data: crmLinks } = await useAsyncData('appnav-crm-links', async () => {
  // Igual que useAuth.ts (HU-ERD-22): en SSR, $fetch a una ruta interna no
  // reenvia sola la cookie httpOnly de la request original - hay que pasarla
  // a mano, o las 3 llamadas dan 401 en el primer render y el menu queda
  // vacio hasta la proxima navegacion.
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
  const results = await Promise.allSettled(
    CRM_ENTRIES.map((entry) => $fetch(`/api/entities/${entry.slug}/fields`, { headers }).then(() => entry))
  )
  return results
    .filter((r): r is PromiseFulfilledResult<CrmEntry> => r.status === 'fulfilled')
    .map((r) => r.value)
})

// HU-ERD-33: seccion "Administracion" (Roles y permisos, HU-ERD-34: Dashboard),
// visible solo si GET /api/roles no tira 403 (requiere rol administrador,
// requireAdminRole - HU-ERD-61) - mismo truco de "probar el endpoint real" que
// los links de arriba, en vez de duplicar en el frontend la logica de "es
// admin" (roles.isSystem no viaja en /api/auth/me hoy). Se prueba solo
// /api/roles (no tambien /api/dashboard/metrics) porque ambos usan el MISMO
// guard - alcanza con uno para saber si el rol es administrador.
const { data: isAdmin } = await useAsyncData('appnav-is-admin', async () => {
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
  try {
    await $fetch('/api/roles', { headers })
    return true
  } catch {
    return false
  }
})

// HU-ERD-35: FEATURE_DASHBOARD=false lo apaga de punta a punta - tambien acá
// (ademas del 404 real en GET /api/dashboard/metrics). GET /api/config, no
// useRuntimeConfig() - ver composables/useDeploymentConfig.ts.
const { data: appConfig } = await useDeploymentConfig()

const items = computed(() => [{ label: 'Inicio', to: '/' }])
const crmItems = computed(() => (crmLinks.value ?? []).map((entry) => ({ label: entry.label, to: `/registros/${entry.slug}` })))
const adminItems = computed(() => {
  if (!isAdmin.value) return []
  const links = [{ label: 'Roles y permisos', to: '/roles' }]
  if (appConfig.value?.featureFlags.dashboard) links.unshift({ label: 'Dashboard', to: '/dashboard' })
  return links
})
</script>

<template>
  <nav class="flex flex-col gap-1 p-3">
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="rounded px-3 py-2 text-sm font-medium text-gray-700 hover:bg-primary-50 hover:text-primary-700"
      active-class="bg-primary-100 text-primary-800"
    >
      {{ item.label }}
    </NuxtLink>

    <template v-if="crmItems.length">
      <p class="mt-3 px-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Directorio</p>
      <NuxtLink
        v-for="item in crmItems"
        :key="item.to"
        :to="item.to"
        class="rounded px-3 py-2 text-sm font-medium text-gray-700 hover:bg-primary-50 hover:text-primary-700"
        active-class="bg-primary-100 text-primary-800"
      >
        {{ item.label }}
      </NuxtLink>
    </template>

    <template v-if="adminItems.length">
      <p class="mt-3 px-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Administración</p>
      <NuxtLink
        v-for="item in adminItems"
        :key="item.to"
        :to="item.to"
        class="rounded px-3 py-2 text-sm font-medium text-gray-700 hover:bg-primary-50 hover:text-primary-700"
        active-class="bg-primary-100 text-primary-800"
      >
        {{ item.label }}
      </NuxtLink>
    </template>
  </nav>
</template>
