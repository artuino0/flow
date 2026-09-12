<script setup lang="ts">
// HU-ERD-33 - Rediseno "pantalla unica" (2026-09-01): la implementacion
// original de esta HU (listado pages/roles/index.vue + edicion
// pages/roles/[id].vue en dos rutas separadas) nunca tenia forma de CREAR un
// rol - ni boton en el frontend ni endpoint en el backend (solo listar y
// editar la matriz de permisos de un rol YA existente). El usuario senalo que
// la pantalla "aun no esta terminada" y pidio revisarla contra el diseno real
// en Pencil antes de tocar nada (regla del proyecto: pencil-antes-de-frontend).
//
// Esa revision (Screen/Roles y Permisos en ERPDinamico.pen) confirmo el hueco
// Y ademas mostro que el diseno real NUNCA fue dos paginas: es una unica
// pantalla con un "Role Selector" (dropdown con buscador, nodo CW5XH) que
// cambia que rol se ve en la Permission Matrix (nodo o27xP) de al lado, mas
// un boton "Crear rol" (nodo b5saUd) en el Toolbar. No hay ningun afordance
// de renombrar/eliminar un rol en el diseno - fuera de alcance a proposito.
//
// Esta pagina reemplaza a pages/roles/index.vue + pages/roles/[id].vue (ambas
// borradas) por esta unica ruta. selectedRoleId es puramente client-side
// (con la excepcion del valor inicial, tomado de ?role= en la URL si viene) -
// no hay ruta dedicada por rol, tal cual el diseno.
import { ArrowRight, Blocks, Check, ChevronDown, Copy, Plus, Search, ShieldCheck, X } from '@lucide/vue'

definePageMeta({ layout: 'default' })

interface RoleRow {
  id: string
  name: string
  isSystem: boolean
  userCount: number
}

interface EntityPermissionRow {
  moduleKind: 'hecho' | 'dimension'
  showInMenu: boolean
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

type PermKey = 'canRead' | 'canCreate' | 'canUpdate' | 'canDelete' | 'showInMenu'

// Columnas de la Permission Matrix: labels tal cual el diseno ("Ver", no
// "Leer" como tenia la implementacion original de HU-ERD-33 - unico texto
// que de verdad no coincidia con el .pen en esa pantalla vieja).
const COLUMNS: { key: PermKey; label: string }[] = [
  { key: 'canRead', label: 'Ver' },
  { key: 'canCreate', label: 'Crear' },
  { key: 'canUpdate', label: 'Editar' },
  { key: 'canDelete', label: 'Eliminar' },
  { key: 'showInMenu', label: 'Mostrar en menú' }
]

const route = useRoute()
const router = useRouter()

// HU-ERD-32: forwarding manual de la cookie en SSR, mismo criterio en las dos
// llamadas a useFetch de esta pagina.
const cookieHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const {
  data: rolesData,
  pending: rolesPending,
  error: rolesError,
  refresh: refreshRoles
} = await useFetch<{ roles: RoleRow[] }>('/api/roles', { key: 'roles-list', headers: cookieHeaders })

const roles = computed(() => rolesData.value?.roles ?? [])

// Valor inicial de selectedRoleId: ?role=<id> de la URL si es un rol real de
// este tenant, si no el primero (orden alfabetico, ya viene ordenado del
// backend). rolesData.value ya esta resuelto en este punto (el await de
// arriba ya termino), asi que esto puede leerse de forma sincrona antes del
// segundo useFetch de abajo.
const queryRoleId = typeof route.query.role === 'string' ? route.query.role : null
const initialRoleId = roles.value.find((r) => r.id === queryRoleId)?.id ?? roles.value[0]?.id ?? null
const selectedRoleId = ref<string | null>(initialRoleId)

const selectedRole = computed(() => roles.value.find((r) => r.id === selectedRoleId.value) ?? null)

const {
  data: permsData,
  pending: permsPending,
  error: permsError
} = await useFetch<RolePermissionsResponse>(() => `/api/roles/${selectedRoleId.value}/permissions`, {
  key: 'role-permissions',
  headers: cookieHeaders,
  watch: [selectedRoleId],
  immediate: !!selectedRoleId.value
})

// Copia local editable - se resetea cada vez que llega/cambia `permsData`
// (carga inicial, cambio de rol seleccionado, o despues de guardar con exito).
const rows = ref<EntityPermissionRow[]>([])
const activeTab = ref<'hecho' | 'dimension'>('hecho')
const visibleRows = computed(() => rows.value.filter(row => (activeTab.value === 'hecho' ? row.moduleKind === 'hecho' : row.moduleKind === 'dimension')))
const visibleColumns = computed(() => activeTab.value === 'dimension' ? COLUMNS.filter(col => col.key !== 'showInMenu') : COLUMNS)
const tabCounts = computed(() => ({ hecho: rows.value.filter(row => row.moduleKind === 'hecho').length, dimension: rows.value.filter(row => row.moduleKind === 'dimension').length }))
watchEffect(() => {
  if (permsData.value) rows.value = permsData.value.permissions.map((p) => ({ ...p }))
})

function toggle(row: EntityPermissionRow, key: PermKey) {
  row[key] = !row[key]
}

const saving = ref(false)
const saveError = ref<string | null>(null)

// Pedido directo del usuario ("aplica los toast, checa donde deben ir") -
// ver composables/useToast.ts. Reemplaza el aviso inline estatico "Permisos
// guardados correctamente." (quedaba invisible con la matriz larga, si el
// usuario ya habia scrolleado).
const toast = useToast()

async function onSave() {
  if (!selectedRoleId.value) return
  saveError.value = null
  saving.value = true
  try {
    const result = await $fetch<RolePermissionsResponse>(`/api/roles/${selectedRoleId.value}/permissions`, {
      method: 'PUT',
      body: { permissions: rows.value.map(({ entityId, canRead, canCreate, canUpdate, canDelete, showInMenu }) => ({ entityId, canRead, canCreate, canUpdate, canDelete, showInMenu })) }
    })
    rows.value = result.permissions.map((p) => ({ ...p }))
    await refreshNuxtData('appnav-modules')
    toast.updated('Permisos actualizados', 'Los cambios se guardaron correctamente.')
  } catch (err: any) {
    saveError.value = err?.data?.statusMessage || 'No se pudieron guardar los permisos'
    toast.error('No se pudieron guardar los permisos', saveError.value)
  } finally {
    saving.value = false
  }
}

// --- Role Selector (dropdown con buscador, nodo CW5XH del diseno) ---
const selectorOpen = ref(false)
const roleSearch = ref('')
const filteredRoles = computed(() => {
  const term = roleSearch.value.trim().toLowerCase()
  if (!term) return roles.value
  return roles.value.filter((r) => r.name.toLowerCase().includes(term))
})

function selectRole(roleId: string) {
  selectedRoleId.value = roleId
  selectorOpen.value = false
  roleSearch.value = ''
  saveError.value = null
  // Deep-link opcional (?role=<id>) para poder compartir/recargar sobre el
  // mismo rol - no forma parte del diseno pero es una mejora minima y segura
  // (el diseno no muestra URLs, no la contradice).
  router.replace({ query: { ...route.query, role: roleId } })
}

// Cierra el dropdown al clickear afuera - sin libreria (mismo criterio "sin
// dependencias nuevas" que el drag-and-drop de ModuleFieldsCard.vue).
const selectorRef = ref<HTMLElement | null>(null)
function onDocumentClick(event: MouseEvent) {
  if (selectorOpen.value && selectorRef.value && !selectorRef.value.contains(event.target as Node)) {
    selectorOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', onDocumentClick))
onUnmounted(() => document.removeEventListener('click', onDocumentClick))

// --- Crear rol (nodo b5saUd del diseno) ---
const createOpen = ref(false)
const createName = ref('')
const createError = ref<string | null>(null)
const creating = ref(false)

function openCreateModal() {
  createName.value = ''
  createError.value = null
  copyFromRoleId.value = null
  copySelectorOpen.value = false
  copyPermCount.value = null
  createOpen.value = true
}

// --- "Copiar permisos de (opcional)" (rediseno "Nuevo Rol", 2026-09-01,
// "checa esto" sobre Screen/Roles y Permisos - Nuevo Rol - hueco encontrado:
// el modal real deja arrancar un rol nuevo copiando los permisos de uno ya
// existente, en vez de siempre en blanco). Selector manual sin libreria,
// mismo patron que el Role Selector de mas arriba, pero sin buscador (el
// diseno no lo trae aca) - la lista de roles ya es la misma `roles` que
// alimenta al Role Selector, no hace falta pedirla de nuevo.
const copyFromRoleId = ref<string | null>(null)
const copySelectorOpen = ref(false)
const copyFromRole = computed(() => roles.value.find((r) => r.id === copyFromRoleId.value) ?? null)

// Cantidad de flags de permiso (true) del rol elegido para copiar - se pide
// bajo demanda con GET /api/roles/:id/permissions (mismo endpoint que ya usa
// la Permission Matrix) en vez de sumar un campo nuevo a GET /api/roles: no
// hace falta cargar esto para roles que nunca se eligen como referencia.
const copyPermCount = ref<number | null>(null)
const copyPermCountLoading = ref(false)

async function selectCopyFromRole(roleId: string | null) {
  copyFromRoleId.value = roleId
  copySelectorOpen.value = false
  copyPermCount.value = null
  if (!roleId) return
  copyPermCountLoading.value = true
  try {
    const result = await $fetch<RolePermissionsResponse>(`/api/roles/${roleId}/permissions`)
    copyPermCount.value = result.permissions.reduce(
      (total, p) => total + [p.canRead, p.canCreate, p.canUpdate, p.canDelete].filter(Boolean).length,
      0
    )
  } catch {
    // Si falla, simplemente no se muestra el texto de ayuda con el conteo -
    // el envio del formulario igual manda copyFromRoleId y el backend hace
    // la copia real; esto es solo la vista previa del numero.
    copyPermCount.value = null
  } finally {
    copyPermCountLoading.value = false
  }
}

const copySelectorRef = ref<HTMLElement | null>(null)
function onCopySelectorDocumentClick(event: MouseEvent) {
  if (copySelectorOpen.value && copySelectorRef.value && !copySelectorRef.value.contains(event.target as Node)) {
    copySelectorOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', onCopySelectorDocumentClick))
onUnmounted(() => document.removeEventListener('click', onCopySelectorDocumentClick))

async function onCreateRole() {
  const name = createName.value.trim()
  if (!name) {
    createError.value = 'El nombre es obligatorio'
    return
  }
  createError.value = null
  creating.value = true
  try {
    const result = await $fetch<{ role: RoleRow }>('/api/roles', {
      method: 'POST',
      body: { name, copyFromRoleId: copyFromRoleId.value }
    })
    await refreshRoles()
    selectRole(result.role.id)
    createOpen.value = false
    toast.success('Rol creado', `"${name}" ya está disponible.`)
  } catch (err: any) {
    createError.value = err?.data?.statusMessage || 'No se pudo crear el rol'
    toast.error('No se pudo crear el rol', createError.value)
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex items-center justify-between">
      <div class="flex flex-col gap-1">
        <h1 class="text-[22px] font-bold text-brand-text">Roles y Permisos</h1>
        <p class="text-sm text-brand-text-secondary">Define los permisos de cada rol y qué módulos aparecen en su menú.</p>
        <p class="text-xs text-brand-text-muted">Ocultar del menú conserva el permiso Ver, el acceso directo y los selectores relacionados. Sin Ver, el módulo no aparece.</p>
      </div>
      <button
        type="button"
        class="flex items-center gap-1.5 rounded bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-orange-hover"
        @click="openCreateModal"
      >
        <Plus class="h-4 w-4" :stroke-width="1.75" />
        Crear rol
      </button>
    </div>

    <p v-if="rolesPending" class="text-sm text-brand-text-muted">Cargando...</p>
    <p v-else-if="rolesError" class="text-sm text-brand-error-text">
      No se pudieron cargar los roles{{ rolesError.statusCode === 403 ? ' (requiere rol administrador)' : '' }}.
    </p>

    <template v-else>
      <p v-if="roles.length === 0" class="text-sm text-brand-text-muted">
        Este tenant todavía no tiene roles. Crea el primero con "Crear rol".
      </p>

      <template v-else>
        <div ref="selectorRef" class="relative flex w-80 flex-col gap-1.5">
          <span class="text-xs font-semibold text-brand-text-muted">Rol seleccionado</span>
          <button
            type="button"
            class="flex items-center justify-between rounded border border-brand-border bg-brand-surface px-3 py-2.5"
            @click="selectorOpen = !selectorOpen"
          >
            <div class="flex items-center gap-2.5">
              <div class="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-brand-blue-bg">
                <ShieldCheck class="h-3.5 w-3.5 text-brand-blue" :stroke-width="1.75" />
              </div>
              <div class="flex flex-col items-start gap-0.5">
                <span class="text-sm font-bold text-brand-text">{{ selectedRole?.name }}</span>
                <span class="text-xs text-brand-text-muted">{{ selectedRole?.userCount }} usuario{{ selectedRole?.userCount === 1 ? '' : 's' }}</span>
              </div>
            </div>
            <ChevronDown class="h-4 w-4 shrink-0 text-brand-text-muted" :stroke-width="1.75" />
          </button>

          <div
            v-if="selectorOpen"
            class="absolute left-0 top-full z-10 mt-1.5 flex max-h-[280px] w-full flex-col overflow-hidden rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_4px_16px_0_#33475B33]"
          >
            <div class="flex shrink-0 items-center gap-2 border-b border-brand-border-light px-3 py-2.5">
              <Search class="h-3.5 w-3.5 shrink-0 text-brand-text-muted" :stroke-width="1.75" />
              <input
                v-model="roleSearch"
                type="text"
                placeholder="Buscar rol..."
                class="w-full text-sm text-brand-text placeholder:text-brand-text-muted focus:outline-none"
              />
            </div>
            <div class="flex flex-col gap-0.5 overflow-y-auto p-1.5">
              <p v-if="filteredRoles.length === 0" class="px-2.5 py-2 text-sm text-brand-text-muted">Ningún rol coincide con "{{ roleSearch }}".</p>
              <button
                v-for="role in filteredRoles"
                :key="role.id"
                type="button"
                class="flex items-center justify-between rounded px-2.5 py-2 text-left"
                :class="role.id === selectedRoleId ? 'bg-brand-sidebar-active-bg' : 'hover:bg-brand-bg'"
                @click="selectRole(role.id)"
              >
                <span class="flex flex-col gap-0.5">
                  <span class="text-sm" :class="role.id === selectedRoleId ? 'font-bold text-brand-blue' : 'font-medium text-brand-text'">{{ role.name }}</span>
                  <span class="text-xs text-brand-text-muted">{{ role.userCount }} usuario{{ role.userCount === 1 ? '' : 's' }}</span>
                </span>
                <Check v-if="role.id === selectedRoleId" class="h-3.5 w-3.5 shrink-0 text-brand-blue" :stroke-width="2" />
              </button>
            </div>
          </div>
        </div>

        <p v-if="permsPending" class="text-sm text-brand-text-muted">Cargando permisos...</p>
        <p v-else-if="permsError" class="text-sm text-brand-error-text">No se pudieron cargar los permisos de este rol.</p>

        <template v-else-if="permsData">
          <p v-if="permsData.role.isSystem" class="text-sm text-brand-text-muted">
            Este es el rol de sistema del tenant - sus permisos acá son independientes del acceso administrativo
            (Configuración general, esta misma pantalla), que depende del rol en sí, no de estos checkboxes.
          </p>

          <!-- Screen/Roles y Permisos - Vacío del .pen ("checa esto" del
          usuario, 2026-09-03): antes era solo texto plano - este es el
          estado vacío real (icono + heading + subtítulo + CTA "Ir a
          Módulos"), para cuando el tenant todavía no tiene ningún módulo
          sobre el que configurar permisos. -->
          <div v-if="rows.length === 0" class="flex flex-col items-center gap-4 rounded-lg border border-brand-border-light bg-brand-surface py-24">
            <div class="flex h-16 w-16 items-center justify-center rounded-full bg-brand-bg">
              <Blocks class="h-7 w-7 text-brand-text-muted" :stroke-width="1.75" />
            </div>
            <div class="flex flex-col items-center gap-1.5">
              <p class="text-[15px] font-bold text-brand-text">No hay módulos para asignar permisos</p>
              <p class="max-w-[360px] text-center text-sm text-brand-text-muted">
                Crea al menos un módulo para poder configurar sus permisos por rol.
              </p>
            </div>
            <NuxtLink
              to="/modulos"
              class="flex items-center gap-1.5 rounded bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-orange-hover"
            >
              Ir a Módulos
              <ArrowRight class="h-4 w-4" :stroke-width="1.75" />
            </NuxtLink>
          </div>

          <div v-else>
            <div class="mb-3 flex items-center gap-1 border-b border-brand-border-light" role="tablist" aria-label="Tipo de entidad">
              <button type="button" role="tab" :aria-selected="activeTab === 'hecho'" class="border-b-2 px-4 py-2.5 text-sm font-semibold" :class="activeTab === 'hecho' ? 'border-brand-orange text-brand-text' : 'border-transparent text-brand-text-muted hover:text-brand-text'" @click="activeTab = 'hecho'">Módulos <span class="ml-1 text-xs font-normal">({{ tabCounts.hecho }})</span></button>
              <button type="button" role="tab" :aria-selected="activeTab === 'dimension'" class="border-b-2 px-4 py-2.5 text-sm font-semibold" :class="activeTab === 'dimension' ? 'border-brand-orange text-brand-text' : 'border-transparent text-brand-text-muted hover:text-brand-text'" @click="activeTab = 'dimension'">Catálogos <span class="ml-1 text-xs font-normal">({{ tabCounts.dimension }})</span></button>
            </div>
            <div class="overflow-x-auto rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
            <table class="min-w-full text-sm">
              <thead class="border-b border-brand-border-light bg-brand-bg">
                <tr>
                  <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">Entidad</th>
                  <th
                    v-for="col in visibleColumns"
                    :key="col.key"
                    class="w-[110px] px-4 py-2.5 text-center text-[12px] font-bold tracking-wide text-brand-text-secondary"
                  >{{ col.label }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-brand-border-light">
                <tr v-for="row in visibleRows" :key="row.entityId" class="hover:bg-brand-bg">
                  <td class="px-4 py-3 font-medium text-brand-text">{{ row.entityName }}</td>
                  <td v-for="col in visibleColumns" :key="col.key" class="px-4 py-3 text-center">
                    <button
                      type="button"
                      class="inline-flex h-[18px] w-[18px] items-center justify-center rounded-[3px] border"
                      role="checkbox"
                      :aria-checked="row[col.key]"
                      :aria-label="`${col.label}: ${row.entityName}`"
                      :class="row[col.key] ? 'border-brand-orange bg-brand-orange' : 'border-brand-border bg-brand-surface'"
                      @click="toggle(row, col.key)"
                    >
                      <Check v-if="row[col.key]" class="h-3 w-3 text-white" :stroke-width="3" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
            <p v-if="visibleRows.length === 0" class="px-2 py-4 text-sm text-brand-text-muted">No hay {{ activeTab === 'hecho' ? 'módulos' : 'catálogos' }} para este rol.</p>
          </div>

          <div class="flex items-center gap-3">
            <button
              type="button"
              :disabled="saving || rows.length === 0"
              class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
              @click="onSave"
            >
              {{ saving ? 'Guardando...' : 'Guardar permisos' }}
            </button>
            <p v-if="saveError" class="text-sm text-brand-error-text">{{ saveError }}</p>
          </div>
        </template>
      </template>
    </template>

    <div v-if="createOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div class="flex w-full max-w-[440px] flex-col rounded-lg bg-brand-surface shadow-xl">
        <div class="relative border-b border-brand-border-light p-5">
          <h2 class="text-[15px] font-bold text-brand-text">Crear nuevo rol</h2>
          <p class="mt-1 text-sm text-brand-text-secondary">Define el nombre y, si quieres, parte de los permisos de otro rol</p>
          <button
            type="button"
            title="Cerrar"
            class="absolute right-5 top-5 flex h-7 w-7 items-center justify-center rounded text-brand-text-muted hover:bg-brand-bg"
            @click="createOpen = false"
          >
            <X class="h-4 w-4" :stroke-width="1.75" />
          </button>
        </div>

        <div class="flex flex-col gap-5 p-5">
          <div class="flex flex-col gap-1.5">
            <label for="new-role-name" class="text-xs font-semibold text-brand-text-secondary">Nombre del rol</label>
            <input
              id="new-role-name"
              v-model="createName"
              type="text"
              placeholder="Supervisor de ventas"
              class="rounded border border-brand-border px-3 py-2 text-sm text-brand-text focus:border-brand-orange focus:outline-none"
              @keydown.enter="onCreateRole"
            />
            <p class="text-xs text-brand-text-muted">Así lo van a ver los usuarios al asignarlo</p>
            <p v-if="createError" class="text-sm text-brand-error-text">{{ createError }}</p>
          </div>

          <div ref="copySelectorRef" class="relative flex flex-col gap-1.5">
            <label class="text-xs font-semibold text-brand-text-secondary">Copiar permisos de (opcional)</label>
            <button
              type="button"
              class="flex items-center justify-between rounded border border-brand-border bg-brand-surface px-3 py-2"
              @click="copySelectorOpen = !copySelectorOpen"
            >
              <span class="flex items-center gap-2">
                <Copy class="h-3.5 w-3.5 shrink-0 text-brand-text-muted" :stroke-width="1.75" />
                <span class="text-sm" :class="copyFromRole ? 'text-brand-text' : 'text-brand-text-muted'">
                  {{ copyFromRole?.name ?? 'Ninguno (empezar en blanco)' }}
                </span>
              </span>
              <ChevronDown class="h-4 w-4 shrink-0 text-brand-text-muted" :stroke-width="1.75" />
            </button>

            <div
              v-if="copySelectorOpen"
              class="absolute left-0 top-full z-10 mt-1.5 flex max-h-[240px] w-full flex-col gap-0.5 overflow-y-auto rounded-lg border border-brand-border-light bg-brand-surface p-1.5 shadow-[0_4px_16px_0_#33475B33]"
            >
              <button
                type="button"
                class="flex items-center justify-between rounded px-2.5 py-2 text-left text-sm"
                :class="!copyFromRoleId ? 'bg-brand-sidebar-active-bg font-bold text-brand-blue' : 'font-medium text-brand-text hover:bg-brand-bg'"
                @click="selectCopyFromRole(null)"
              >
                Ninguno (empezar en blanco)
                <Check v-if="!copyFromRoleId" class="h-3.5 w-3.5 shrink-0 text-brand-blue" :stroke-width="2" />
              </button>
              <button
                v-for="role in roles"
                :key="role.id"
                type="button"
                class="flex items-center justify-between rounded px-2.5 py-2 text-left text-sm"
                :class="role.id === copyFromRoleId ? 'bg-brand-sidebar-active-bg font-bold text-brand-blue' : 'font-medium text-brand-text hover:bg-brand-bg'"
                @click="selectCopyFromRole(role.id)"
              >
                {{ role.name }}
                <Check v-if="role.id === copyFromRoleId" class="h-3.5 w-3.5 shrink-0 text-brand-blue" :stroke-width="2" />
              </button>
            </div>

            <p v-if="copyPermCountLoading" class="text-xs text-brand-text-muted">Calculando permisos a copiar...</p>
            <p v-else-if="copyFromRole && copyPermCount !== null" class="text-xs text-brand-text-muted">
              Se copiarán los {{ copyPermCount }} permisos de {{ copyFromRole.name }} como punto de partida. Podrás editarlos después.
            </p>
          </div>
        </div>

        <div class="flex items-center justify-end gap-3 border-t border-brand-border-light p-5">
          <button type="button" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg" @click="createOpen = false">
            Cancelar
          </button>
          <button
            type="button"
            :disabled="creating"
            class="flex items-center gap-1.5 rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
            @click="onCreateRole"
          >
            <Plus class="h-4 w-4" :stroke-width="1.75" />
            {{ creating ? 'Creando...' : 'Crear rol' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
