<script setup lang="ts">
// HU-ERD-21: placeholder estatico original del menu lateral.
//
// ERD-43/ERD-44 (2026-09-01, pedido directo del usuario: "el menu aun no
// renderisa las entidades"): reemplaza el bloque anterior de HU-ERD-32 (que
// solo resolvia punto a punto las 3 entidades hardcodeadas del modulo
// CRM/Directorio Central - Clientes/Empresas/Empleados) por un listado
// GENERICO armado desde GET /api/nav/entities (server/utils/moduleEntities.ts,
// listVisibleEntities()) - CUALQUIER modulo creado desde el Constructor de
// Módulos (HU-ERD-65+) aparece aca solo, sin tocar este archivo, apenas el
// rol del usuario tenga canRead sobre el. Ese endpoint ya filtra por permiso
// y excluye modulos inactivos para roles no-admin (mismo criterio que
// requirePermission()) - aca no hay logica de permisos propia, solo se pinta
// lo que el backend ya decidio que es visible.
//
// Icono por modulo: entities.icon (pedido directo del usuario, mismo dia -
// "un selector de iconos... se puede editar", ver components/IconPicker.vue)
// resuelto via moduleIconComponent() (utils/moduleIcons.ts), con fallback al
// icono generico "blocks" para modulos sin icono elegido todavia.
//
// Diseno Pencil: look de "Sidebar Item" (icono + label, activo con fondo +
// borde izquierdo azul) y titulos de seccion en mayusculas, igual que
// Screen/Dashboard, Screen/List Clientes, etc. del .pen. El .pen no dibuja un
// mock de la seccion de modulos con MAS de 3 items (no existia el concepto de
// modulo custom cuando se diseño el Sidebar) - se mantiene el mismo look de
// seccion ya establecido, con el titulo "MÓDULOS" (el nombre real de la
// epica, ERD-65) en vez de "DIRECTORIO" (ese nombre era especifico del CRM
// hardcodeado que este cambio retira).
import { LayoutDashboard, ShieldCheck, Settings, Blocks, Users, Zap } from '@lucide/vue'
import { moduleIconComponent } from '~/utils/moduleIcons'

interface NavEntity {
  slug: string
  name: string
  icon: string | null
}

const { data: navEntitiesData } = await useAsyncData('appnav-modules', async () => {
  // Igual que useAuth.ts (HU-ERD-22): en SSR, $fetch a una ruta interna no
  // reenvia sola la cookie httpOnly de la request original - hay que pasarla
  // a mano, o el menu queda vacio hasta la proxima navegacion. Cualquier
  // error (401 sin sesion, 403 sin rol) se trata como "sin modulos visibles"
  // en vez de romper el layout - mismo criterio de "no rompe" que el resto
  // de esta pantalla (isAdmin de abajo usa el mismo patron).
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
  try {
    return await $fetch<{ entities: NavEntity[] }>('/api/nav/entities', { headers })
  } catch {
    return { entities: [] }
  }
})

const moduleItems = computed(() =>
  (navEntitiesData.value?.entities ?? []).map((entity) => ({
    label: entity.name,
    to: `/registros/${entity.slug}`,
    icon: moduleIconComponent(entity.icon)
  }))
)

// HU-ERD-33: seccion "Administracion" (Roles y permisos, Ajustes),
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

// Reubicacion del menu (feedback del usuario, post-HU-ERD-67): "Tablero"
// (ex-Dashboard) y la vieja "Inicio" (bienvenida vacia) eran dos pantallas
// separadas en / y /dashboard - se fusionaron en una sola, en /, y dejo de
// estar gateada a administrador (ver requireAuth en
// server/api/dashboard/metrics.get.ts) - por eso vive fija en GENERAL, sin
// condicionarla a isAdmin/appConfig como antes. La pantalla en si sigue
// respetando FEATURE_DASHBOARD (HU-ERD-35) puertas adentro (pages/index.vue).
const items = computed(() => [{ label: 'Tablero', to: '/', icon: LayoutDashboard }])
// "Ajustes" es un placeholder (pages/ajustes/index.vue) - se reserva el
// lugar en el menu a pedido del usuario; el alcance real es una HU aparte.
// "Modulos" (HU-ERD-69) usa el mismo guard que ya prueba isAdmin arriba
// (GET /api/roles y GET /api/entities comparten requireAdminRole) - no hace
// falta una tercera llamada "de prueba" solo para este link. Icono "blocks"
// verificado contra Sidebar Item/Active de Screen/Listado Modulos en el .pen
// (no elegido a mano).
const adminItems = computed(() => {
  if (!isAdmin.value) return []
  return [
    { label: 'Módulos', to: '/modulos', icon: Blocks },
    // HU-ERD-51: "Automatización" (Screen/Triggers del .pen, disenada para
    // esta HU - no existia antes ningun mock, revisado/creado con las
    // herramientas de Pencil antes de este cambio). Mismo guard que el resto
    // de Administracion (GET /api/roles ya probado arriba) - administrar
    // triggers es configuracion de la plataforma, igual que Modulos/Roles.
    { label: 'Automatización', to: '/triggers', icon: Zap },
    // HU-ERD-84: "Usuarios" (Screen/Usuarios del .pen) - mismo guard que el
    // resto de Administracion, gestionar accesos es una accion de admin.
    { label: 'Usuarios', to: '/usuarios', icon: Users },
    { label: 'Roles y permisos', to: '/roles', icon: ShieldCheck },
    { label: 'Ajustes', to: '/ajustes', icon: Settings }
  ]
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

    <div v-if="moduleItems.length" class="flex flex-col gap-px">
      <p class="px-3 py-1.5 text-[11px] font-bold tracking-wide text-brand-text-muted">MÓDULOS</p>
      <NuxtLink
        v-for="item in moduleItems"
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
