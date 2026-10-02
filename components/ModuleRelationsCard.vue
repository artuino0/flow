<script setup lang="ts">
// HU-ERD-77: card "Relaciones" de Editar Módulo - administra
// relation_definitions (el mecanismo de grafo generico de ERD-10/19), que
// hasta esta HU no tenia NINGUNA forma de crearse desde ningun lado (ver el
// comentario largo en server/utils/relationDefinitions.ts).
//
// Diseno: revisado en Pencil antes de construir (regla pencil-antes-de-frontend)
// - existe un mock real ("Screen/Agregar Campo - Relación (1:N)") pero
// describe algo bastante mas grande (cardinalidad 1:1/1:N, snapshot de
// campos al vincular, y campos propios del vinculo con su propia columna en
// record_relations) que un CRUD simple de relation_definitions - decision
// explicita del usuario (2026-09-01): construir esta version simple ahora,
// SIN ese mock, siguiendo el mismo lenguaje visual general de las otras
// cards de esta pantalla (mismo patron que ModuleFieldsCard.vue: card con
// header + lista de filas + boton "Nueva relación"), y dejar el diseño
// completo de ese mock para una HU futura mejor dimensionada.
//
// Desde esta card, el modulo actual SIEMPRE se crea como origen
// (sourceEntityId) de la relacion nueva - evita un selector de "direccion"
// confuso; para modelar el otro sentido se crea la definicion desde la
// pestaña "Relaciones" del OTRO modulo.
import { ref, computed, onMounted } from 'vue'
import { Link2, Pencil, Plus, Trash2, X } from '@lucide/vue'

interface RelationDefinition {
  id: string
  name: string
  sourceEntityId: string
  sourceEntitySlug: string
  sourceEntityName: string
  targetEntityId: string
  targetEntitySlug: string
  targetEntityName: string
  linkCount: number
}

interface EntityOption {
  id: string
  name: string
}

const props = defineProps<{
  entityId: string
  entityName: string
  entityOptions: EntityOption[]
}>()

const relations = ref<RelationDefinition[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)

async function loadRelations() {
  loading.value = true
  loadError.value = null
  try {
    relations.value = await $fetch<RelationDefinition[]>('/api/relation-definitions', { query: { entityId: props.entityId } })
  } catch (err: any) {
    loadError.value = err?.data?.statusMessage || 'No se pudieron cargar las relaciones'
  } finally {
    loading.value = false
  }
}
onMounted(loadRelations)

// Entidad relacionada elegible: cualquier modulo del tenant, INCLUIDO el
// propio (una relacion de una entidad consigo misma es un caso legitimo,
// ej. "Empresa matriz de Empresa" - ver relationDefinitions.ts).
const otherEntities = computed(() => props.entityOptions)

// Pedido directo del usuario ("aplica los toast, checa donde deben ir") -
// ver composables/useToast.ts.
const toast = useToast()
const { confirm: confirmAction } = useConfirm()

const formOpen = ref(false)
const formName = ref('')
const formTargetEntityId = ref('')
const saving = ref(false)
const formError = ref<string | null>(null)

function openForm() {
  formName.value = ''
  formTargetEntityId.value = otherEntities.value[0]?.id ?? ''
  formError.value = null
  formOpen.value = true
}
function closeForm() {
  formOpen.value = false
}

async function onCreate() {
  if (!formName.value.trim() || !formTargetEntityId.value) return
  formError.value = null
  saving.value = true
  try {
    await $fetch('/api/relation-definitions', {
      method: 'POST',
      body: { name: formName.value.trim(), sourceEntityId: props.entityId, targetEntityId: formTargetEntityId.value }
    })
    formOpen.value = false
    await loadRelations()
    toast.success('Relación creada', `"${formName.value.trim()}" se agregó correctamente.`)
  } catch (err: any) {
    formError.value = err?.data?.statusMessage || 'No se pudo crear la relación'
    toast.error('No se pudo crear la relación', formError.value)
  } finally {
    saving.value = false
  }
}

const renamingId = ref<string | null>(null)
const renameValue = ref('')
const renameError = ref<string | null>(null)
const renaming = ref(false)

function startRename(relation: RelationDefinition) {
  renamingId.value = relation.id
  renameValue.value = relation.name
  renameError.value = null
}
function cancelRename() {
  renamingId.value = null
}
async function confirmRename(relation: RelationDefinition) {
  if (!renameValue.value.trim()) return
  renameError.value = null
  renaming.value = true
  try {
    await $fetch(`/api/relation-definitions/${relation.id}`, { method: 'PUT', body: { name: renameValue.value.trim() } })
    renamingId.value = null
    await loadRelations()
    toast.updated('Relación actualizada', `Se renombró a "${renameValue.value.trim()}".`)
  } catch (err: any) {
    renameError.value = err?.data?.statusMessage || 'No se pudo renombrar la relación'
    toast.error('No se pudo renombrar la relación', renameError.value)
  } finally {
    renaming.value = false
  }
}

const deleteError = ref<string | null>(null)
const deletingId = ref<string | null>(null)

async function onDelete(relation: RelationDefinition) {
  deleteError.value = null
  if (relation.linkCount > 0) {
    deleteError.value = `No se puede eliminar "${relation.name}": ya tiene ${relation.linkCount} vínculo${relation.linkCount === 1 ? '' : 's'} creado${relation.linkCount === 1 ? '' : 's'}.`
    return
  }
  if (!await confirmAction({ title: 'Eliminar relación', message: `¿Eliminar la relación "${relation.name}"? Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar', destructive: true })) return

  deletingId.value = relation.id
  try {
    await $fetch(`/api/relation-definitions/${relation.id}`, { method: 'DELETE' })
    await loadRelations()
    toast.success('Relación eliminada', `"${relation.name}" se eliminó correctamente.`)
  } catch (err: any) {
    deleteError.value = err?.data?.statusMessage || 'No se pudo eliminar la relación'
    toast.error('No se pudo eliminar la relación', deleteError.value)
  } finally {
    deletingId.value = null
  }
}

function otherSide(relation: RelationDefinition) {
  // Cuando el modulo actual es origen Y destino a la vez (self-relation), da
  // igual cual lado se muestre - se toma el destino, mas natural de leer.
  return relation.sourceEntityId === props.entityId
    ? { role: 'Vincula con', entityName: relation.targetEntityName }
    : { role: 'Vinculada desde', entityName: relation.sourceEntityName }
}
</script>

<template>
  <div class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_rgb(var(--brand-shadow)/0.0784313725490196)]">
    <div class="flex items-center justify-between border-b border-brand-border-light p-5">
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2"><h2 class="text-[15px] font-bold text-brand-text">Relaciones</h2><ModuleTourHelpButton tab="relations" /></div>
        <p class="text-sm text-brand-text-secondary">Tipos de vínculo entre {{ entityName }} y otros módulos.</p>
      </div>
      <button
        type="button"
        :disabled="otherEntities.length === 0"
        class="flex items-center gap-1.5 rounded bg-brand-orange px-3.5 py-2 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
        data-tour="edit-relations-add"
        @click="openForm"
      >
        <Plus class="h-4 w-4" :stroke-width="2" />
        Nueva relación
      </button>
    </div>

    <div v-if="formOpen" class="flex flex-col gap-3 border-b border-brand-border-light bg-brand-bg p-5">
      <div class="flex flex-col gap-1.5">
        <label class="text-[13px] font-semibold text-brand-text">Nombre</label>
        <input
          v-model="formName"
          type="text"
          placeholder="ej. Recepción pertenece a Productor"
          class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
        />
      </div>
      <div class="flex flex-col gap-1.5">
        <label class="text-[13px] font-semibold text-brand-text">Entidad relacionada</label>
        <select
          v-model="formTargetEntityId"
          class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
        >
          <option v-for="opt in otherEntities" :key="opt.id" :value="opt.id">{{ opt.name }}</option>
        </select>
        <p class="text-xs text-brand-text-muted">{{ entityName }} queda como origen de esta relación.</p>
      </div>
      <p v-if="formError" class="text-sm text-brand-error-text">{{ formError }}</p>
      <div class="flex justify-end gap-2">
        <button type="button" class="rounded border border-brand-border px-3.5 py-1.5 text-sm font-semibold text-brand-text hover:bg-brand-surface" @click="closeForm">
          Cancelar
        </button>
        <button
          type="button"
          :disabled="saving || !formName.trim()"
          class="rounded bg-brand-orange px-3.5 py-1.5 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
          @click="onCreate"
        >
          {{ saving ? 'Creando...' : 'Crear relación' }}
        </button>
      </div>
    </div>

    <p v-if="loading" class="p-5 text-sm text-brand-text-muted">Cargando...</p>
    <p v-else-if="loadError" class="p-5 text-sm text-brand-error-text">{{ loadError }}</p>
    <p v-else-if="relations.length === 0" class="p-5 text-sm text-brand-text-muted">
      Este módulo todavía no tiene relaciones definidas con otros módulos.
    </p>

    <div v-else data-tour="edit-relations-rows" class="flex flex-col divide-y divide-brand-border-light">
      <div v-for="relation in relations" :key="relation.id" class="flex items-center justify-between gap-3 p-4">
        <div class="flex items-center gap-3">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-brand-blue-bg text-brand-blue">
            <Link2 class="h-4 w-4" :stroke-width="1.75" />
          </span>
          <div class="flex flex-col">
            <template v-if="renamingId === relation.id">
              <input
                v-model="renameValue"
                type="text"
                class="rounded border border-brand-border px-2 py-1 text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                @keyup.enter="confirmRename(relation)"
                @keyup.esc="cancelRename"
              />
            </template>
            <span v-else class="text-sm font-semibold text-brand-text">{{ relation.name }}</span>
            <span class="text-xs text-brand-text-muted">
              {{ otherSide(relation).role }} <strong>{{ otherSide(relation).entityName }}</strong>
              · {{ relation.linkCount }} vínculo{{ relation.linkCount === 1 ? '' : 's' }}
            </span>
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-1">
          <template v-if="renamingId === relation.id">
            <button type="button" :disabled="renaming" class="px-2 py-1 text-xs font-semibold text-brand-text-secondary hover:text-brand-text" @click="cancelRename">
              <X class="h-4 w-4" :stroke-width="1.75" />
            </button>
            <button
              type="button"
              :disabled="renaming || !renameValue.trim()"
              class="rounded bg-brand-orange px-2.5 py-1 text-xs font-semibold text-brand-primary-fg hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
              @click="confirmRename(relation)"
            >
              {{ renaming ? 'Guardando...' : 'Guardar' }}
            </button>
          </template>
          <template v-else>
            <button type="button" class="rounded p-1.5 text-brand-text-secondary hover:bg-brand-bg hover:text-brand-text" title="Renombrar" @click="startRename(relation)">
              <Pencil class="h-3.5 w-3.5" :stroke-width="1.75" />
            </button>
            <button
              type="button"
              :disabled="deletingId === relation.id"
              class="rounded p-1.5 text-brand-text-secondary hover:bg-brand-error-bg hover:text-brand-error-text"
              title="Eliminar"
              @click="onDelete(relation)"
            >
              <Trash2 class="h-3.5 w-3.5" :stroke-width="1.75" />
            </button>
          </template>
        </div>
      </div>
    </div>

    <p v-if="renameError" class="mx-5 mb-4 text-sm text-brand-error-text">{{ renameError }}</p>
    <p v-if="deleteError" class="mx-5 mb-4 text-sm text-brand-error-text">{{ deleteError }}</p>
  </div>
</template>

<style scoped>
/* HU-164: controles nativos con el esquema del ámbito y el blanco claro original. */
:where(input, select, textarea) { color-scheme: inherit; }
:where(select, textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"])):not([class*="bg-"]) { background-color: rgb(var(--brand-surface)); }
</style>
