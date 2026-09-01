<script setup lang="ts">
// HU-ERD-69: listado de modulos (entities) del tenant - solo Administrador
// (mismo guard que el resto de la seccion Administracion). Sigue el diseno
// real de Screen/Listado Modulos en ERPDinamico.pen (revisado con las
// herramientas de Pencil, no inferido de otra pantalla del repo): breadcrumb,
// toolbar con buscador + boton "Crear modulo", tabla Modulo/Registros/Campos/
// Creado/Acciones.
//
// Rediseno "Editar Módulo" (2026-09-01): la columna "Estado" (Publicado/
// Borrador en el diseno original de esta pantalla, que no tenia mock propio
// actualizado) ya NO se omite - ahora existe un concepto real de "modulo
// activo/inactivo" (entities.is_active, ver comentario largo en
// server/db/schema.ts), asi que se agrega como badge Activo/Inactivo
// (mismo look que el badge del header de pages/modulos/[id]/editar.vue).
//
// "Crear modulo" y "Editar" navegan a paginas dedicadas (pages/modulos/nuevo.vue,
// pages/modulos/[id]/editar.vue) en vez de un panel/card en esta misma
// pantalla - el diseno no trae ningun formulario inline aca, y el patron ya
// establecido en el repo para editar es una pagina propia (pages/modulos/[id]/editar.vue
// mismo, ver arriba). Son formularios deliberadamente minimos (nombre/slug/descripcion); el
// asistente completo con vista previa en vivo es HU-ERD-70, todavia sin
// implementar.
import { Blocks, ChevronRight, Search, Settings2, Trash2 } from '@lucide/vue'
import { moduleIconComponent } from '~/utils/moduleIcons'

definePageMeta({ layout: 'default' })

interface ModuleRow {
  id: string
  slug: string
  name: string
  description: string | null
  isActive: boolean
  createdAt: string
  recordCount: number
  fieldCount: number
  // Pedido directo del usuario (2026-09-01): icono editable del modulo - ver
  // comentario largo en server/db/schema.ts. Null hasta que se elija uno
  // (components/IconPicker.vue, desde "Editar módulo") - moduleIconComponent()
  // cae al icono generico "blocks" en ese caso.
  icon: string | null
}

const { data, pending, error: fetchError, refresh } = await useFetch<{ entities: ModuleRow[] }>('/api/entities', {
  key: 'modulos-list',
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

async function onDelete(module: ModuleRow) {
  if (!confirm(`Eliminar el modulo "${module.name}"? Esta accion no se puede deshacer.`)) return

  deleteError.value = null
  deletingId.value = module.id
  try {
    await $fetch(`/api/entities/${module.id}`, { method: 'DELETE' })
    await refresh()
  } catch (err: any) {
    // Criterio de aceptacion HU-ERD-69: el 409 de "tiene registros" (HU-ERD-66)
    // se muestra tal cual lo manda el backend (ya trae el conteo), no un error
    // generico de "algo salio mal".
    deleteError.value = err?.data?.statusMessage || 'No se pudo eliminar el modulo'
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center gap-1 text-[13px]">
      <span class="text-brand-text-secondary">Inicio</span>
      <ChevronRight class="h-[13px] w-[13px] text-brand-text-muted" :stroke-width="2" />
      <span class="font-bold text-brand-text">Módulos</span>
    </div>

    <p v-if="pending" class="text-sm text-brand-text-muted">Cargando...</p>
    <p v-else-if="fetchError" class="text-sm text-brand-error-text">
      No se pudo cargar el listado de módulos{{ fetchError.statusCode === 403 ? ' (requiere rol administrador)' : '' }}.
    </p>

    <template v-else-if="data">
      <div class="flex items-center justify-between">
        <div class="flex flex-col gap-1">
          <h1 class="text-[22px] font-bold text-brand-text">Módulos</h1>
          <p class="text-sm text-brand-text-secondary">Entidades de negocio personalizadas de tu organización</p>
        </div>

        <div class="flex items-center gap-2.5">
          <div class="flex w-60 items-center gap-2 rounded border border-brand-border bg-brand-surface px-3 py-2">
            <Search class="h-[15px] w-[15px] shrink-0 text-brand-text-muted" :stroke-width="1.75" />
            <input
              v-model="search"
              type="text"
              placeholder="Buscar módulo..."
              class="w-full text-sm text-brand-text placeholder:text-brand-text-muted focus:outline-none"
            />
          </div>
          <NuxtLink
            to="/modulos/nuevo"
            class="flex items-center gap-1.5 rounded bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-orange-hover"
          >
            <Blocks class="h-4 w-4" :stroke-width="1.75" />
            Crear módulo
          </NuxtLink>
        </div>
      </div>

      <p v-if="deleteError" class="rounded border border-brand-error-text bg-brand-error-bg px-3 py-2 text-sm text-brand-error-text">
        {{ deleteError }}
      </p>

      <p v-if="data.entities.length === 0" class="text-sm text-brand-text-muted">Este tenant todavía no tiene módulos.</p>
      <p v-else-if="filteredModules.length === 0" class="text-sm text-brand-text-muted">Ningún módulo coincide con "{{ search }}".</p>

      <div v-else class="overflow-x-auto rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
        <table class="min-w-full text-sm">
          <thead class="border-b border-brand-border-light bg-brand-bg">
            <tr>
              <th class="px-4 py-2.5 text-left text-[12px] font-bold tracking-wide text-brand-text-secondary">Módulo</th>
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
                  :class="module.isActive ? 'bg-brand-success-bg text-brand-success-text' : 'bg-brand-neutral-bg text-brand-neutral-text'"
                >{{ module.isActive ? 'Activo' : 'Inactivo' }}</span>
              </td>
              <td class="px-4 py-3 text-right text-brand-text">{{ module.recordCount }}</td>
              <td class="px-4 py-3 text-right text-brand-text">{{ module.fieldCount }}</td>
              <td class="px-4 py-3 text-brand-text-secondary">{{ formatDate(module.createdAt) }}</td>
              <td class="px-4 py-3">
                <div class="flex gap-1.5">
                  <NuxtLink
                    :to="`/modulos/${module.id}/editar`"
                    title="Editar"
                    class="flex h-[26px] w-[26px] items-center justify-center rounded bg-brand-surface text-brand-text-secondary hover:bg-brand-bg"
                  >
                    <Settings2 class="h-3.5 w-3.5" :stroke-width="1.75" />
                  </NuxtLink>
                  <button
                    type="button"
                    title="Eliminar"
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
</template>
