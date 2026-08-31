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
//
// Diseno Pencil: look de "Sidebar Item" (icono + label, activo con fondo +
// borde izquierdo azul) y titulos de seccion en mayusculas, igual que
// Screen/Dashboard, Screen/List Clientes, etc. del .pen.
import { LayoutDashboard, Users, Building2, UserRound, Folder, ShieldCheck } from '@lucide/vue'
import type { Component } from 'vue'

interface CrmEntry {
  slug: string
  label: string
}

const CRM_ENTRIES: CrmEntry[] = [
  { slug: 'clientes', label: 'Clientes' },
  { slug: 'empresas', label: 'Empresas' },
  { slug: 'empleados', label: 'Empleados' }
]

const CRM_ICONS: Record<string, Component> = {
  clientes: Users,
  empresas: Building2,
  empleados: UserRound
}

function iconFor(slug: string): Component {
  return CRM_ICONS[slug] ?? Folder
}

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

const items = computed(() => [{ label: 'Inicio', to: '/', icon: LayoutDashboard }])
const crmItems = computed(() =>
  (crmLinks.value ?? []).map((entry) => ({ label: entry.label, to: `/registros/${entry.slug}`, icon: iconFor(entry.slug) }))
)
const adminItems = computed(() => {
  if (!isAdmin.value) return []
  const links = [{ label: 'Roles y permisos', to: '/roles', icon: ShieldCheck }]
  if (appConfig.value?.featureFlags.dashboard) links.unshift({ label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard })
  return links
})

const route = useRoute()
function isActive(to: string): boolean {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}
</script>

<template>
  <nav class="flex flex-col gap-4">
    <div class="flex flex-col gap-px">
      <p class="px-3 py-1.5 text-[11px] font-bold tracking-wide text-brand-text-muted">GENERAL</p>
      <NuxtLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-2.5 rounded px-3 py-2 text-sm font-medium"
        :class="isActive(item.to) ? 'border-l-[3px] border-brand-blue bg-brand-sidebar-active-bg pl-[9px] font-semibold text-brand-blue' : 'text-brand-text-secondary hover:bg-brand-bg'"
      >
        <component :is="item.icon" class="h-[17px] w-[17px] shrink-0" :stroke-width="1.75" />
        {{ item.label }}
      </NuxtLink>
    </div>

    <div v-if="crmItems.length" class="flex flex-col gap-px">
      <p class="px-3 py-1.5 text-[11px] font-bold tracking-wide text-brand-text-muted">DIRECTORIO</p>
      <NuxtLink
        v-for="item in crmItems"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-2.5 rounded px-3 py-2 text-sm font-medium"
        :class="isActive(item.to) ? 'border-l-[3px] border-brand-blue bg-brand-sidebar-active-bg pl-[9px] font-semibold text-brand-blue' : 'text-brand-text-secondary hover:bg-brand-bg'"
      >
        <component :is="item.icon" class="h-[17px] w-[17px] shrink-0" :stroke-width="1.75" />
        {{ item.label }}
      </NuxtLink>
    </div>

    <div v-if="adminItems.length" class="flex flex-col gap-px">
      <p class="px-3 py-1.5 text-[11px] font-bold tracking-wide text-brand-text-muted">ADMINISTRACIÓN</p>
      <NuxtLink
        v-for="item in adminItems"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-2.5 rounded px-3 py-2 text-sm font-medium"
        :class="isActive(item.to) ? 'border-l-[3px] border-brand-blue bg-brand-sidebar-active-bg pl-[9px] font-semibold text-brand-blue' : 'text-brand-text-secondary hover:bg-brand-bg'"
      >
        <component :is="item.icon" class="h-[17px] w-[17px] shrink-0" :stroke-width="1.75" />
        {{ item.label }}
      </NuxtLink>
    </div>
  </nav>
</template>
