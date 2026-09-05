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
import { LayoutDashboard, ShieldCheck, Settings, Blocks, Users, Zap, Library, ChevronDown } from '@lucide/vue'
import { moduleIconComponent } from '~/utils/moduleIcons'

// Pedido directo del usuario (2026-09-05): "hay manera de hacer desplegable
// el nivel principal del menu, general, entidades, administracion" - las 3
// secciones (GENERAL/MÓDULOS/ADMINISTRACIÓN) pasan de titulo estatico a
// boton plegable (chevron que rota + oculta sus items). Sin mock en el .pen
// para esto (el componente "Sidebar Section Title" del diseno es solo un
// texto, sin chevron/estado de plegado - confirmado con las herramientas de
// Pencil antes de este cambio), asi que se sigue el mismo lenguaje visual ya
// establecido (chevron, mismo icono que ya usan los dropdown de
// pages/login.vue/layouts/default.vue) en vez de inventar uno nuevo.
// Estado persistido en localStorage (clave por seccion, no por usuario - es
// una preferencia de UI del navegador, no un dato de negocio) para que la
// eleccion sobreviva a recargar la pagina; default abierto (mismo
// comportamiento que antes de este cambio) si no hay nada guardado o
// localStorage no esta disponible (navegacion privada, etc.).
type SidebarSection = 'general' | 'modulos' | 'administracion'
const SIDEBAR_SECTIONS_STORAGE_KEY = 'flowerp-sidebar-sections-open'
const sectionsOpen = reactive<Record<SidebarSection, boolean>>({
  general: true,
  modulos: true,
  administracion: true
})
onMounted(() => {
  try {
    const raw = localStorage.getItem(SIDEBAR_SECTIONS_STORAGE_KEY)
    if (raw) Object.assign(sectionsOpen, JSON.parse(raw))
  } catch {
    // localStorage no disponible (navegacion privada, etc.) - se queda con el default (abierto).
  }
})
function toggleSection(key: SidebarSection) {
  sectionsOpen[key] = !sectionsOpen[key]
  try {
    localStorage.setItem(SIDEBAR_SECTIONS_STORAGE_KEY, JSON.stringify(sectionsOpen))
  } catch {
    // idem - si no se puede persistir, el toggle igual funciona para esta sesion.
  }
}

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
//
// Pedido directo del usuario (2026-09-05): extraido a composables/useIsAdmin.ts
// para que pages/registros/[entity]/index.vue (boton "Editar módulo" del
// listado, solo-admin) pueda reusar el mismo dato sin duplicar este
// fetch+try/catch - misma key de useAsyncData, Nuxt lo deduplica solo.
const { data: isAdmin } = await useIsAdmin()

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
    // ERD-86: "Catálogos" - modulos de tipo dimension (Cultivo, Productor,
    // Clientes/Empresas/Empleados) ya no aparecen en la seccion "MÓDULOS"
    // dinamica de arriba (listVisibleEntities() ahora filtra a moduleKind=
    // 'hecho', ver comentario largo en server/db/schema.ts) - se administran
    // desde aca. Sin mock propio en el .pen (confirmado listando los
    // Screen/* existentes) - reusa Screen/Listado Módulos, ver comentario
    // largo en components/ModuleWizard.vue. Mismo guard que el resto de
    // Administracion.
    { label: 'Catálogos', to: '/catalogos', icon: Library },
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
      <button
        type="button"
        class="flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-[11px] font-bold tracking-wide text-brand-text-muted hover:text-brand-text-secondary"
        @click="toggleSection('general')"
      >
        <span>GENERAL</span>
        <ChevronDown class="h-3.5 w-3.5 shrink-0 transition-transform" :class="{ '-rotate-90': !sectionsOpen.general }" :stroke-width="2" />
      </button>
      <template v-if="sectionsOpen.general">
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
      </template>
    </div>

    <div v-if="moduleItems.length" class="flex flex-col gap-px">
      <button
        type="button"
        class="flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-[11px] font-bold tracking-wide text-brand-text-muted hover:text-brand-text-secondary"
        @click="toggleSection('modulos')"
      >
        <span>MÓDULOS</span>
        <ChevronDown class="h-3.5 w-3.5 shrink-0 transition-transform" :class="{ '-rotate-90': !sectionsOpen.modulos }" :stroke-width="2" />
      </button>
      <template v-if="sectionsOpen.modulos">
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
      </template>
    </div>

    <div v-if="adminItems.length" class="flex flex-col gap-px">
      <button
        type="button"
        class="flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-[11px] font-bold tracking-wide text-brand-text-muted hover:text-brand-text-secondary"
        @click="toggleSection('administracion')"
      >
        <span>ADMINISTRACIÓN</span>
        <ChevronDown class="h-3.5 w-3.5 shrink-0 transition-transform" :class="{ '-rotate-90': !sectionsOpen.administracion }" :stroke-width="2" />
      </button>
      <template v-if="sectionsOpen.administracion">
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
      </template>
    </div>
  </nav>
</template>
