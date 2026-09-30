<script setup lang="ts">
// HU-ERD-74: card "Ficha del registro" - configurador del "Diseño del
// detalle" (Screen/Diseño del Detalle del .pen, revisado con las
// herramientas de Pencil antes de construir). Tres secciones: PROPIEDADES
// (campos propios de la entidad), RELACIONES (campos "relation" de OTRAS
// entidades que apuntan a esta, ver server/utils/detailLayout.ts) y ACTIVIDAD
// (un toggle - ver la nota grande en components/RecordDetailView.vue sobre
// por que la línea de tiempo real queda fuera de alcance).
//
// Sigue los controles y el arrastrar/soltar de Diseño del listado. Una
// etiqueta de tipo de dato mantiene el contexto de cada propiedad.
// HU-ERD-75: el mapa de etiquetas por tipo se extrajo a utils/fieldTypeLabels.ts
// (ahora compartido con ModuleListLayoutCard.vue).
import { Check, GripVertical } from '@lucide/vue'
import type { DetailLayout, EntityFieldMeta, InverseRelation } from '~/composables/useEntityFields'

const props = defineProps<{
  fields: EntityFieldMeta[]
  inverseRelations: InverseRelation[]
  modelValue: DetailLayout
}>()

const emit = defineEmits<{
  'update:modelValue': [value: DetailLayout]
}>()

function fieldMeta(name: string): EntityFieldMeta | undefined {
  return props.fields.find((f) => f.name === name)
}
function relMeta(entitySlug: string, fieldName: string): InverseRelation | undefined {
  return props.inverseRelations.find((r) => r.entitySlug === entitySlug && r.fieldName === fieldName)
}

// Líneas editables: la ficha permite agregar/editar/quitar los registros hijos
// de una relación inversa y sumar campos numéricos al pie.
function updateRelation(entitySlug: string, fieldName: string, patch: Partial<DetailLayout['relations'][number]>) {
  emit('update:modelValue', {
    ...props.modelValue,
    relations: props.modelValue.relations.map((r) => (r.entitySlug === entitySlug && r.fieldName === fieldName ? { ...r, ...patch } : r))
  })
}
const childFields = reactive<Record<string, EntityFieldMeta[]>>({})
async function loadChildFields(entitySlug: string) {
  if (childFields[entitySlug]) return
  try {
    childFields[entitySlug] = (await $fetch<{ fields: EntityFieldMeta[] }>(`/api/entities/${entitySlug}/fields`)).fields
  } catch { childFields[entitySlug] = [] }
}
watch(() => props.modelValue.relations, (relations) => {
  for (const r of relations) if (r.editable) void loadChildFields(r.entitySlug)
}, { immediate: true })
function numericFields(entitySlug: string) {
  return (childFields[entitySlug] ?? []).filter((f) => ['number', 'currency'].includes(f.dataType))
}
function toggleEditable(rel: DetailLayout['relations'][number]) {
  updateRelation(rel.entitySlug, rel.fieldName, rel.editable ? { editable: false, totals: [] } : { editable: true })
  if (!rel.editable) void loadChildFields(rel.entitySlug)
}
function toggleTotal(rel: DetailLayout['relations'][number], name: string) {
  const current = rel.totals ?? []
  updateRelation(rel.entitySlug, rel.fieldName, { totals: current.includes(name) ? current.filter((n) => n !== name) : [...current, name] })
}

function togglePropertyVisible(name: string) {
  emit('update:modelValue', {
    ...props.modelValue,
    properties: props.modelValue.properties.map((p) => (p.name === name ? { ...p, visible: !p.visible } : p))
  })
}
function toggleRelationVisible(entitySlug: string, fieldName: string) {
  emit('update:modelValue', {
    ...props.modelValue,
    relations: props.modelValue.relations.map((r) => (r.entitySlug === entitySlug && r.fieldName === fieldName ? { ...r, visible: !r.visible } : r))
  })
}
type Section = 'properties' | 'relations'
const dragging = ref<{ section: Section; index: number } | null>(null)
const dropIndicator = ref<{ section: Section; index: number; position: 'before' | 'after' } | null>(null)

function onDragStart(section: Section, index: number, event: DragEvent) {
  dragging.value = { section, index }
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', `${section}:${index}`)
  }
}
function onDragOver(section: Section, index: number, event: DragEvent) {
  if (dragging.value?.section !== section) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropIndicator.value = { section, index, position: event.clientY - rect.top < rect.height / 2 ? 'before' : 'after' }
}
function onDragLeave(section: Section, index: number) {
  if (dropIndicator.value?.section === section && dropIndicator.value.index === index) dropIndicator.value = null
}
function onDragEnd() {
  dragging.value = null
  dropIndicator.value = null
}
function onDrop(section: Section) {
  const source = dragging.value
  const target = dropIndicator.value
  onDragEnd()
  if (!source || !target || source.section !== section || target.section !== section) return
  let to = target.index + (target.position === 'after' ? 1 : 0)
  if (source.index < to) to -= 1
  if (source.index === to) return
  const next = [...props.modelValue[section]]
  const [item] = next.splice(source.index, 1)
  next.splice(to, 0, item)
  emit('update:modelValue', { ...props.modelValue, [section]: next })
}

function toggleActivity() {
  emit('update:modelValue', { ...props.modelValue, showActivity: !props.modelValue.showActivity })
}
</script>

<template>
  <div class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-brand-border-light p-5">
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2"><h2 class="text-[15px] font-bold text-brand-text">Ficha del registro</h2><ModuleTourHelpButton tab="detail" /></div>
        <p class="text-sm text-brand-text-secondary">Elige qué se muestra en la ficha y arrastra para cambiar el orden</p>
      </div>
      <slot name="actions" />
    </div>

    <div class="flex flex-col gap-5 p-5">
      <div data-tour="edit-detail-properties" class="flex flex-col gap-1.5">
        <p class="text-[11px] font-bold uppercase tracking-wide text-brand-text-muted">Propiedades</p>
        <p v-if="modelValue.properties.length === 0" class="text-xs text-brand-text-muted">Este módulo todavía no tiene campos.</p>
        <div
          v-for="(prop, index) in modelValue.properties"
          :key="prop.name"
          class="relative flex items-center gap-2.5 rounded px-1.5 py-1.5 transition-opacity hover:bg-brand-bg"
          :class="dragging?.section === 'properties' && dragging.index === index ? 'opacity-40' : ''"
          draggable="true"
          @dragstart="onDragStart('properties', index, $event)"
          @dragover.prevent="onDragOver('properties', index, $event)"
          @dragleave="onDragLeave('properties', index)"
          @dragend="onDragEnd"
          @drop.prevent="onDrop('properties')"
        >
          <span v-if="dropIndicator?.section === 'properties' && dropIndicator.index === index" class="absolute inset-x-0 h-0.5 rounded-full bg-brand-orange" :class="dropIndicator.position === 'before' ? 'top-0' : 'bottom-0'" />
          <GripVertical class="h-4 w-4 shrink-0 cursor-grab text-brand-text-muted active:cursor-grabbing" :stroke-width="1.75" />
          <button type="button" role="checkbox" :aria-checked="prop.visible" :aria-label="`Mostrar ${fieldMeta(prop.name)?.label ?? prop.name}`" class="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] border" :class="prop.visible ? 'border-brand-orange bg-brand-orange' : 'border-brand-border bg-brand-surface'" @click="togglePropertyVisible(prop.name)"><Check v-if="prop.visible" class="h-3 w-3 text-white" :stroke-width="3" /></button>
          <span class="min-w-0 flex-1 truncate text-sm text-brand-text">{{ fieldMeta(prop.name)?.label ?? prop.name }}</span>
          <span class="shrink-0 rounded-full bg-brand-neutral-bg px-2 py-0.5 text-xs font-semibold text-brand-neutral-text">
            {{ fieldTypeLabel(fieldMeta(prop.name)?.dataType) }}
          </span>
        </div>
      </div>

      <div data-tour="edit-detail-relations" class="flex flex-col gap-1.5 border-t border-brand-border-light pt-4">
        <p class="text-[11px] font-bold uppercase tracking-wide text-brand-text-muted">Relaciones</p>
        <p v-if="modelValue.relations.length === 0" class="text-xs text-brand-text-muted">
          Ningún otro módulo tiene un campo de tipo Relación apuntando a este.
        </p>
        <template v-for="(rel, index) in modelValue.relations" :key="`${rel.entitySlug}.${rel.fieldName}`">
        <div
          class="relative flex items-center gap-2.5 rounded px-1.5 py-1.5 transition-opacity hover:bg-brand-bg"
          :class="dragging?.section === 'relations' && dragging.index === index ? 'opacity-40' : ''"
          draggable="true"
          @dragstart="onDragStart('relations', index, $event)"
          @dragover.prevent="onDragOver('relations', index, $event)"
          @dragleave="onDragLeave('relations', index)"
          @dragend="onDragEnd"
          @drop.prevent="onDrop('relations')"
        >
          <span v-if="dropIndicator?.section === 'relations' && dropIndicator.index === index" class="absolute inset-x-0 h-0.5 rounded-full bg-brand-orange" :class="dropIndicator.position === 'before' ? 'top-0' : 'bottom-0'" />
          <GripVertical class="h-4 w-4 shrink-0 cursor-grab text-brand-text-muted active:cursor-grabbing" :stroke-width="1.75" />
          <button type="button" role="checkbox" :aria-checked="rel.visible" :aria-label="`Mostrar ${rel.entitySlug}`" class="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] border" :class="rel.visible ? 'border-brand-orange bg-brand-orange' : 'border-brand-border bg-brand-surface'" @click="toggleRelationVisible(rel.entitySlug, rel.fieldName)"><Check v-if="rel.visible" class="h-3 w-3 text-white" :stroke-width="3" /></button>
          <span class="min-w-0 flex-1 truncate text-sm text-brand-text">
            {{ relMeta(rel.entitySlug, rel.fieldName)?.entityName ?? rel.entitySlug }}
            <span class="text-brand-text-muted">({{ relMeta(rel.entitySlug, rel.fieldName)?.fieldLabel ?? rel.fieldName }})</span>
          </span>
          <button type="button" role="switch" :aria-checked="Boolean(rel.editable)" class="shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold" :class="rel.editable ? 'border-brand-orange bg-brand-orange text-white' : 'border-brand-border text-brand-text-secondary hover:bg-brand-bg'" @click="toggleEditable(rel)">{{ rel.editable ? 'Editable' : 'Solo lectura' }}</button>
          <span class="shrink-0 rounded-full bg-brand-neutral-bg px-2 py-0.5 text-xs font-semibold text-brand-neutral-text">Tabla</span>
        </div>
        <div v-if="rel.editable" class="-mt-0.5 mb-1 ml-[52px] flex flex-wrap items-center gap-1.5">
          <span class="text-xs text-brand-text-muted">Totales al pie:</span>
          <span v-if="!numericFields(rel.entitySlug).length" class="text-xs text-brand-text-muted">este módulo no tiene campos numéricos.</span>
          <button v-for="f in numericFields(rel.entitySlug)" :key="f.name" type="button" role="checkbox" :aria-checked="(rel.totals ?? []).includes(f.name)" class="rounded-full border px-2 py-0.5 text-xs font-semibold" :class="(rel.totals ?? []).includes(f.name) ? 'border-brand-orange bg-brand-orange text-white' : 'border-brand-border text-brand-text-secondary hover:bg-brand-bg'" @click="toggleTotal(rel, f.name)">{{ f.label }}</button>
        </div>
        </template>
      </div>

      <div data-tour="edit-detail-activity" class="flex items-center justify-between border-t border-brand-border-light pt-4">
        <div class="flex flex-col gap-0.5">
          <p class="text-sm font-semibold text-brand-text">Mostrar línea de tiempo de actividad</p>
          <p class="text-xs text-brand-text-muted">Muestra los cambios y notas del registro en su ficha.</p>
        </div>
        <button
          type="button"
          class="flex h-[22px] w-[38px] shrink-0 items-center rounded-full p-[2px] transition-colors"
          :class="modelValue.showActivity ? 'justify-end bg-brand-orange' : 'justify-start border border-brand-border bg-brand-surface'"
          @click="toggleActivity"
        >
          <span class="h-[18px] w-[18px] rounded-full bg-white shadow" />
        </button>
      </div>
    </div>
  </div>
</template>
