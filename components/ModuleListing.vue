<script setup lang="ts">
// ERD-86: listado de modulos, extraido de pages/modulos/index.vue (HU-ERD-69)
// para reusarlo tal cual desde pages/catalogos/index.vue (nueva) - pedido
// directo del usuario ("es mas podriamos usar el mismo componente con un
// query param de type"): en vez de un query param sobre una unica ruta
// (complica el resaltado de activo en AppNav.vue y el breadcrumb, ya que
// Módulos y Catálogos comparten el mismo pathname), se mantienen dos rutas
// propias (/modulos, /catalogos - cada una con su entrada de menu y su
// titulo de pestaña) pero con el MISMO componente por dentro, mismo criterio
// que components/ModuleWizard.vue para el asistente.
import { Blocks, Eye, Plus, RotateCcw, Settings2, Trash2 } from '@lucide/vue'
import type { NavigationFailure } from 'vue-router'
import { moduleIconComponent } from '~/utils/moduleIcons'
import type { ModuleKind } from '~/server/utils/moduleEntities'

const props = defineProps<{
  // '/modulos' o '/catalogos'.
  basePath: string
  moduleKind: ModuleKind
  // Plural para breadcrumb/titulo ("Módulos" / "Catálogos").
  sectionLabel: string
  // Singular en minuscula, para textos ("módulo" / "catálogo").
  noun: string
  subtitle: string
  searchPlaceholder: string
  createLabel: string
  // Solo 'dimension' la necesita: un catalogo no aparece en AppNav.vue
  // (listVisibleEntities() filtra a 'hecho', ver comentario largo en
  // server/db/schema.ts), asi que esta es la UNICA forma de llegar a sus
  // datos fuera del selector de relacion de un modulo de tipo hecho.
  showViewRecordsAction?: boolean
  edgeHeader?: boolean
}>()

interface ModuleRow {
  id: string
  slug: string
  name: string
  description: string | null
  isActive: boolean
  deletedAt: string | null
  createdAt: string
  recordCount: number
  fieldCount: number
  icon: string | null
}

const showDeleted = ref(false)
const { data, pending, error: fetchError, refresh } = await useFetch<{ entities: ModuleRow[] }>('/api/entities', {
  key: `${props.moduleKind}-list`,
  query: computed(() => ({ moduleKind: props.moduleKind, deleted: showDeleted.value ? 'only' : 'exclude' })),
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})

const search = ref('')
const filteredModules = computed(() => {
  const modules = data.value?.entities ?? []
  const term = search.value.trim().toLowerCase()
  if (!term) return modules
  return modules.filter((m) => m.name.toLowerCase().includes(term) || m.slug.toLowerCase().includes(term))
})

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
}

const deleteError = ref<string | null>(null)
const deletingId = ref<string | null>(null)

// Pedido directo del usuario ("aplica los toast, checa donde deben ir") - ver
// composables/useToast.ts.
const toast = useToast()
const { confirm: confirmAction } = useConfirm()
const { checkBeforeCreate, handlePlanLimitError } = usePlanLimit()

// HU-ERD-104c: crear un módulo de hechos consume cuota del plan ('modules') -
// avisar al presionar el botón, antes de abrir el asistente. Los catálogos
// (moduleKind='dimension') no cuentan para la cuota: nunca se bloquean.
// Los NuxtLink de crear usan el slot `custom` (renderizan su propio <a>):
// así el handler decide SIEMPRE antes que el navigate interno de RouterLink
// (con @click normal sobre <NuxtLink>, vue-router arranca la navegación
// primero y el preventDefault async llegaría tarde). Clicks con modificadores
// (ctrl/medio) se dejan al navegador, igual que hace guardEvent de vue-router.
async function onCreateClick(event: MouseEvent, navigate: (e?: MouseEvent) => Promise<void | NavigationFailure>) {
  if (props.moduleKind === 'dimension') return navigate(event)
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
  event.preventDefault()
  if (await checkBeforeCreate('modules')) await navigate()
}

async function onDelete(module: ModuleRow) {
  if (!await confirmAction({ title: `Deshabilitar ${props.noun}`, message: `¿Deshabilitar el ${props.noun} "${module.name}"? Sus registros y referencias seguirán disponibles para consulta.`, confirmLabel: 'Deshabilitar', destructive: true })) return

  deleteError.value = null
  deletingId.value = module.id
  try {
    await $fetch(`/api/entities/${module.id}`, { method: 'DELETE' })
    await refresh()
    toast.success(`${props.noun.charAt(0).toUpperCase()}${props.noun.slice(1)} deshabilitado`, `"${module.name}" se puede restaurar desde módulos borrados.`)
  } catch (err: any) {
    deleteError.value = err?.data?.statusMessage || `No se pudo eliminar el ${props.noun}`
    toast.error(`No se pudo eliminar el ${props.noun}`, deleteError.value)
  } finally {
    deletingId.value = null
  }
}

async function onRestore(module: ModuleRow) {
  deletingId.value = module.id
  deleteError.value = null
  try {
    await $fetch(`/api/entities/${module.id}/restore`, { method: 'POST' })
    await refresh()
    toast.success(`${props.noun.charAt(0).toUpperCase()}${props.noun.slice(1)} restaurado`, `"${module.name}" vuelve a estar disponible.`)
  } catch (err: any) {
    // HU-ERD-104c: restaurar un módulo de hechos vuelve a consumir cuota de
    // 'modules' y el servidor ahora lo bloquea con 402 'plan_limit' - mostrar
    // el mismo aviso con "Mejorar plan" en vez del toast genérico.
    if (await handlePlanLimitError(err)) return
    deleteError.value = err?.data?.statusMessage || `No se pudo restaurar el ${props.noun}`
    toast.error('No se pudo restaurar', deleteError.value)
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <div class="flex min-w-0 flex-col" :class="edgeHeader ? 'h-full overflow-y-auto bg-brand-bg' : 'gap-4'">
    <ListPageHeader
      :style="edgeHeader ? { '--list-page-gutter-x': '0px', '--list-page-gutter-y': '0px' } : undefined"
      v-model:search="search"
      :title="sectionLabel"
      :description="subtitle"
      :count="data?.entities.length"
      :count-noun="noun"
      :search-placeholder="searchPlaceholder"
      @refresh="refresh"
    >
      <template #actions>
        <NuxtLink to="/organizacion" class="flex h-[35px] items-center rounded border border-brand-border px-4 text-sm font-semibold text-brand-text hover:bg-brand-bg">Organizar menú</NuxtLink>
        <NuxtLink v-slot="{ href, navigate }" custom :to="basePath + '/nuevo'">
          <a :href="href ?? undefined" :data-tour="moduleKind === 'hecho' ? 'manual-create' : undefined" class="flex h-[35px] items-center gap-1.5 rounded bg-brand-orange px-4 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover" @click="onCreateClick($event, navigate)">
            <Blocks class="h-4 w-4" :stroke-width="1.75" />
            {{ createLabel }}
          </a>
        </NuxtLink>
      </template>
    </ListPageHeader>

    <div class="flex min-w-0 flex-col gap-4" :class="edgeHeader ? 'p-7 max-sm:p-4' : ''">
    <p v-if="pending" class="text-sm text-brand-text-muted">Cargando...</p>
    <p v-else-if="fetchError" class="text-sm text-brand-error-text">
      No se pudo cargar el listado{{ fetchError.statusCode === 403 ? ' (requiere rol administrador)' : '' }}.
    </p>

    <template v-else-if="data">
      <p v-if="deleteError" class="rounded border border-brand-error-text bg-brand-error-bg px-3 py-2 text-sm text-brand-error-text">
        {{ deleteError }}
      </p>

      <label class="flex w-fit cursor-pointer items-center gap-2 text-sm font-semibold text-brand-text-secondary">
        <input v-model="showDeleted" type="checkbox" class="accent-brand-orange" /> Ver módulos borrados
      </label>

      <!-- Screen/Listado Módulos - Vacío del .pen ("checa esto" del usuario,
      2026-09-03): antes era solo texto plano, este es el estado vacío real
      (icono + heading + subtítulo + CTA), reusado tal cual para Catálogos
      con noun/createLabel/basePath (mismo criterio que el resto del
      componente). -->
      <div v-if="data.entities.length === 0 && !showDeleted" class="flex flex-col items-center gap-4 rounded-lg border border-brand-border-light bg-brand-surface py-24">
        <div class="flex h-16 w-16 items-center justify-center rounded-full bg-brand-bg">
          <Blocks class="h-7 w-7 text-brand-text-muted" :stroke-width="1.75" />
        </div>
        <div class="flex flex-col items-center gap-1.5">
          <p class="text-[15px] font-bold text-brand-text">No hay {{ noun }}s creados</p>
          <p class="max-w-[360px] text-center text-sm text-brand-text-muted">
            Crea tu primer {{ noun }} para empezar a modelar entidades personalizadas de tu negocio.
          </p>
        </div>
        <NuxtLink v-slot="{ href, navigate }" custom :to="`${basePath}/nuevo`">
          <a
            :href="href ?? undefined"
            class="flex items-center gap-1.5 rounded bg-brand-orange px-4 py-2.5 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover"
            @click="onCreateClick($event, navigate)"
          >
            <Plus class="h-4 w-4" :stroke-width="1.75" />
            {{ createLabel }}
          </a>
        </NuxtLink>
      </div>
      <p v-else-if="filteredModules.length === 0" class="text-sm text-brand-text-muted">{{ showDeleted ? 'No hay módulos borrados' : `Ningún ${noun} coincide con "${search}".` }}</p>

      <div v-else class="overflow-x-auto rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_rgb(var(--brand-shadow)/0.0784313725490196)]">
        <table class="min-w-full text-sm">
          <thead class="border-b border-brand-border-light bg-brand-bg">
            <tr>
              <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary capitalize">{{ noun }}</th>
              <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">Estado</th>
              <th class="px-4 py-2.5 text-right text-[12px] font-bold tracking-wide text-brand-text-secondary">Registros</th>
              <th class="px-4 py-2.5 text-right text-[12px] font-bold tracking-wide text-brand-text-secondary">Campos</th>
              <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">Creado</th>
              <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-brand-border-light">
            <tr v-for="module in filteredModules" :key="module.id" class="hover:bg-brand-bg">
              <td class="px-4 py-3">
                <div class="flex items-center gap-2.5">
                  <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-brand-blue-bg">
                    <component :is="moduleIconComponent(module.icon)" class="h-4 w-4 text-brand-blue" :stroke-width="1.75" />
                  </div>
                  <div class="flex flex-col">
                    <span class="font-semibold text-brand-text">{{ module.name }}</span>
                    <span class="text-xs text-brand-text-muted">/{{ module.slug }}</span>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3">
                <span
                  class="rounded-full px-2 py-0.5 text-xs font-semibold"
                  :class="module.deletedAt ? 'bg-brand-error-bg text-brand-error-text' : module.isActive ? 'bg-brand-success-bg text-brand-success-text' : 'bg-brand-neutral-bg text-brand-neutral-text'"
                >{{ module.deletedAt ? 'Borrado' : module.isActive ? 'Activo' : 'Inactivo' }}</span>
              </td>
              <td class="px-4 py-3 text-right text-brand-text">{{ module.recordCount }}</td>
              <td class="px-4 py-3 text-right text-brand-text">{{ module.fieldCount }}</td>
              <td class="px-4 py-3 text-brand-text-secondary">{{ formatDate(module.createdAt) }}</td>
              <td class="px-4 py-3">
                <div class="flex gap-1.5">
                  <NuxtLink
                    v-if="showViewRecordsAction || module.deletedAt"
                    :to="`/registros/${module.slug}`"
                    title="Ver registros"
                    class="flex h-[26px] w-[26px] items-center justify-center rounded bg-brand-surface text-brand-text-secondary hover:bg-brand-bg"
                  >
                    <Eye class="h-3.5 w-3.5" :stroke-width="1.75" />
                  </NuxtLink>
                  <NuxtLink
                    v-if="!module.deletedAt"
                    :to="`/modulos/${module.id}/editar`"
                    title="Editar"
                    class="flex h-[26px] w-[26px] items-center justify-center rounded bg-brand-surface text-brand-text-secondary hover:bg-brand-bg"
                  >
                    <Settings2 class="h-3.5 w-3.5" :stroke-width="1.75" />
                  </NuxtLink>
                  <button v-if="module.deletedAt"
                    type="button"
                    title="Restaurar"
                    :disabled="deletingId === module.id"
                    class="flex h-[26px] w-[26px] items-center justify-center rounded bg-brand-surface text-brand-blue hover:bg-brand-blue-bg disabled:opacity-60"
                    @click="onRestore(module)"
                  ><RotateCcw class="h-3.5 w-3.5" :stroke-width="1.75" /></button>
                  <button v-else
                    type="button"
                    title="Deshabilitar"
                    :disabled="deletingId === module.id"
                    class="flex h-[26px] w-[26px] items-center justify-center rounded bg-brand-surface text-brand-error-text hover:bg-brand-error-bg disabled:cursor-not-allowed disabled:opacity-60"
                    @click="onDelete(module)"
                  >
                    <Trash2 class="h-3.5 w-3.5" :stroke-width="1.75" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    </div>
  </div>
</template>

<style scoped>
/* HU-164: controles nativos con el esquema del ámbito y el blanco claro original. */
:where(input, select, textarea) { color-scheme: inherit; }
:where(select, textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"])):not([class*="bg-"]) { background-color: rgb(var(--brand-surface)); }
</style>
