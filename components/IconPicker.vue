<script setup lang="ts">
// Pedido directo del usuario (2026-09-01): "un selector de iconos, para
// poder elegir el icono que usara el modulo, se puede editar". No hay mock
// propio en Pencil para el selector en si - revisado antes de construir
// (regla del proyecto, pencil-antes-de-frontend): Screen/Editar Módulo solo
// dibuja el icono ya elegido como una IconBox de solo lectura en el Header
// Row (nodo Frum5/XhUxl), sin ningun control para cambiarlo, y Screen/Crear
// Módulo Paso1 no contempla icono en absoluto. El look de este componente es
// una extrapolacion documentada: reusa el mismo lenguaje visual ya
// establecido en la app (IconBox circular + popover, mismo patron de
// dropdown manual sin libreria que el Role Selector de pages/roles/index.vue).
//
// Feedback directo del usuario sobre la primera version (mismo dia, 24
// iconos curados sin buscador): "cuando decia selector de iconos me
// imaginaba que me darias un componente como el que tienes ya creado pero
// con todos los iconos y un buscador" - ahora el picker lista el catalogo
// COMPLETO (MODULE_ICONS, 1781 iconos, ver utils/moduleIcons.ts) con un
// campo de busqueda que filtra por nombre; sin busqueda se muestra el
// catalogo entero en una grilla con scroll propio (no hay mock de Pencil que
// dicte un limite, y recortar la lista por defecto iria en contra del pedido
// explicito de "todos los iconos").
//
// Segundo pedido del usuario, mismo dia: "ocupo que me pongas un lapicito en
// una esquina para que sepan que es editable" - badge circular con el icono
// Pencil superpuesto en la esquina inferior derecha del trigger, visible
// solo cuando el picker esta habilitado (si esta disabled, no hay nada que
// editar).
import { Pencil, Search } from '@lucide/vue'
import { MODULE_ICONS, moduleIconComponent } from '~/utils/moduleIcons'

const props = defineProps<{ modelValue: string | null; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const open = ref(false)
const search = ref('')
const rootRef = ref<HTMLElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)

const filteredIcons = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return MODULE_ICONS
  return MODULE_ICONS.filter((opt) => opt.label.toLowerCase().includes(term) || opt.key.toLowerCase().includes(term))
})

function select(key: string) {
  emit('update:modelValue', key)
  open.value = false
  search.value = ''
}

async function toggleOpen() {
  open.value = !open.value
  if (open.value) {
    await nextTick()
    searchInputRef.value?.focus()
  }
}

function onDocumentClick(event: MouseEvent) {
  if (open.value && rootRef.value && !rootRef.value.contains(event.target as Node)) {
    open.value = false
    search.value = ''
  }
}
onMounted(() => document.addEventListener('click', onDocumentClick))
onUnmounted(() => document.removeEventListener('click', onDocumentClick))
</script>

<template>
  <div ref="rootRef" class="relative inline-block">
    <button
      type="button"
      :disabled="disabled"
      title="Cambiar ícono del módulo"
      class="relative flex h-[38px] w-[38px] items-center justify-center rounded bg-brand-blue-bg hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
      @click="toggleOpen"
    >
      <component :is="moduleIconComponent(props.modelValue)" class="h-[19px] w-[19px] text-brand-blue" :stroke-width="1.75" />
      <span
        v-if="!disabled"
        title="Este ícono se puede editar"
        class="absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-brand-surface bg-brand-orange text-brand-primary-fg"
      >
        <Pencil class="h-[10px] w-[10px]" :stroke-width="2.5" />
      </span>
    </button>

    <div
      v-if="open"
      class="absolute left-0 top-full z-10 mt-1.5 flex w-72 flex-col gap-2 rounded-lg border border-brand-border-light bg-brand-surface p-2 shadow-[0_4px_16px_0_rgb(var(--brand-shadow)/0.2)]"
    >
      <div class="flex items-center gap-2 rounded border border-brand-border bg-brand-bg px-2.5 py-1.5">
        <Search class="h-[14px] w-[14px] shrink-0 text-brand-text-muted" :stroke-width="1.75" />
        <input
          ref="searchInputRef"
          v-model="search"
          type="text"
          placeholder="Buscar ícono..."
          class="w-full bg-brand-bg text-sm text-brand-text placeholder:text-brand-text-muted focus:outline-none"
        />
      </div>

      <p v-if="filteredIcons.length === 0" class="px-1 py-3 text-center text-sm text-brand-text-muted">
        Ningún ícono coincide con "{{ search }}".
      </p>

      <div v-else class="grid max-h-64 grid-cols-6 gap-1 overflow-y-auto">
        <button
          v-for="opt in filteredIcons"
          :key="opt.key"
          type="button"
          :title="opt.label"
          class="relative flex h-9 w-9 items-center justify-center rounded"
          :class="opt.key === props.modelValue ? 'bg-brand-blue-bg text-brand-blue' : 'text-brand-text-secondary hover:bg-brand-bg'"
          @click="select(opt.key)"
        >
          <component :is="opt.component" class="h-[18px] w-[18px]" :stroke-width="1.75" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
input, textarea, select { color-scheme: inherit; }
</style>
