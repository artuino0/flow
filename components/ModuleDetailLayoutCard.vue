<script setup lang="ts">
// HU-ERD-74: card "Ficha del registro" - configurador del "Diseño del
// detalle" (Screen/Diseño del Detalle del .pen, revisado con las
// herramientas de Pencil antes de construir). Tres secciones: PROPIEDADES
// (campos propios de la entidad), RELACIONES (campos "relation" de OTRAS
// entidades que apuntan a esta, ver server/utils/detailLayout.ts) y ACTIVIDAD
// (un toggle - ver la nota grande en components/RecordDetailView.vue sobre
// por que la línea de tiempo real queda fuera de alcance).
//
// Simplificación documentada sobre el diseño (mismo criterio ya establecido
// en FieldFormModal.vue, HU-ERD-71): el diseño dice "reordená arrastrando"
// (drag-and-drop); acá se resuelve con botones ↑/↓, mismo alcance funcional
// sin sumar una librería de drag-and-drop solo para esto. También se omite
// el ícono propio por tipo de dato (TYPE_BADGE de ModuleFieldsCard.vue no
// está exportado) - una etiqueta de texto simple alcanza para este contexto,
// donde lo que importa es el orden/visibilidad, no reconocer el tipo a simple vista.
// HU-ERD-75: el mapa de etiquetas por tipo se extrajo a utils/fieldTypeLabels.ts
// (ahora compartido con ModuleListLayoutCard.vue).
import { ChevronDown } from '@lucide/vue'
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

function togglePropertyVisible(name: string) {
  emit('update:modelValue', {
    ...props.modelValue,
    properties: props.modelValue.properties.map((p) => (p.name === name ? { ...p, visible: !p.visible } : p))
  })
}
function moveProperty(index: number, dir: -1 | 1) {
  const target = index + dir
  const list = props.modelValue.properties
  if (target < 0 || target >= list.length) return
  const next = [...list]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  emit('update:modelValue', { ...props.modelValue, properties: next })
}

function toggleRelationVisible(entitySlug: string, fieldName: string) {
  emit('update:modelValue', {
    ...props.modelValue,
    relations: props.modelValue.relations.map((r) => (r.entitySlug === entitySlug && r.fieldName === fieldName ? { ...r, visible: !r.visible } : r))
  })
}
function moveRelation(index: number, dir: -1 | 1) {
  const target = index + dir
  const list = props.modelValue.relations
  if (target < 0 || target >= list.length) return
  const next = [...list]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  emit('update:modelValue', { ...props.modelValue, relations: next })
}

function toggleActivity() {
  emit('update:modelValue', { ...props.modelValue, showActivity: !props.modelValue.showActivity })
}
</script>

<template>
  <div class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
    <div class="flex flex-col gap-1 border-b border-brand-border-light p-5">
      <h2 class="text-[15px] font-bold text-brand-text">Ficha del registro</h2>
      <p class="text-sm text-brand-text-secondary">Elegí qué se muestra en la ficha y reordená con las flechas</p>
    </div>

    <div class="flex flex-col gap-5 p-5">
      <div class="flex flex-col gap-1.5">
        <p class="text-[11px] font-bold uppercase tracking-wide text-brand-text-muted">Propiedades</p>
        <p v-if="modelValue.properties.length === 0" class="text-xs text-brand-text-muted">Este módulo todavía no tiene campos.</p>
        <div
          v-for="(prop, index) in modelValue.properties"
          :key="prop.name"
          class="flex items-center gap-2.5 rounded px-1.5 py-1.5 hover:bg-brand-bg"
        >
          <input type="checkbox" :checked="prop.visible" class="h-3.5 w-3.5 shrink-0" @change="togglePropertyVisible(prop.name)" />
          <span class="min-w-0 flex-1 truncate text-sm text-brand-text">{{ fieldMeta(prop.name)?.label ?? prop.name }}</span>
          <span class="shrink-0 rounded-full bg-brand-neutral-bg px-2 py-0.5 text-xs font-semibold text-brand-neutral-text">
            {{ fieldTypeLabel(fieldMeta(prop.name)?.dataType) }}
          </span>
          <div class="flex shrink-0 gap-0.5">
            <button type="button" title="Mover arriba" :disabled="index === 0" class="flex h-6 w-6 items-center justify-center rounded text-brand-text-muted hover:bg-brand-bg disabled:opacity-30" @click="moveProperty(index, -1)">
              <ChevronDown class="h-3.5 w-3.5 rotate-180" :stroke-width="1.75" />
            </button>
            <button type="button" title="Mover abajo" :disabled="index === modelValue.properties.length - 1" class="flex h-6 w-6 items-center justify-center rounded text-brand-text-muted hover:bg-brand-bg disabled:opacity-30" @click="moveProperty(index, 1)">
              <ChevronDown class="h-3.5 w-3.5" :stroke-width="1.75" />
            </button>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-1.5 border-t border-brand-border-light pt-4">
        <p class="text-[11px] font-bold uppercase tracking-wide text-brand-text-muted">Relaciones</p>
        <p v-if="modelValue.relations.length === 0" class="text-xs text-brand-text-muted">
          Ningún otro módulo tiene un campo de tipo Relación apuntando a este.
        </p>
        <div
          v-for="(rel, index) in modelValue.relations"
          :key="`${rel.entitySlug}.${rel.fieldName}`"
          class="flex items-center gap-2.5 rounded px-1.5 py-1.5 hover:bg-brand-bg"
        >
          <input type="checkbox" :checked="rel.visible" class="h-3.5 w-3.5 shrink-0" @change="toggleRelationVisible(rel.entitySlug, rel.fieldName)" />
          <span class="min-w-0 flex-1 truncate text-sm text-brand-text">
            {{ relMeta(rel.entitySlug, rel.fieldName)?.entityName ?? rel.entitySlug }}
            <span class="text-brand-text-muted">({{ relMeta(rel.entitySlug, rel.fieldName)?.fieldLabel ?? rel.fieldName }})</span>
          </span>
          <span class="shrink-0 rounded-full bg-brand-neutral-bg px-2 py-0.5 text-xs font-semibold text-brand-neutral-text">Tabla</span>
          <div class="flex shrink-0 gap-0.5">
            <button type="button" title="Mover arriba" :disabled="index === 0" class="flex h-6 w-6 items-center justify-center rounded text-brand-text-muted hover:bg-brand-bg disabled:opacity-30" @click="moveRelation(index, -1)">
              <ChevronDown class="h-3.5 w-3.5 rotate-180" :stroke-width="1.75" />
            </button>
            <button type="button" title="Mover abajo" :disabled="index === modelValue.relations.length - 1" class="flex h-6 w-6 items-center justify-center rounded text-brand-text-muted hover:bg-brand-bg disabled:opacity-30" @click="moveRelation(index, 1)">
              <ChevronDown class="h-3.5 w-3.5" :stroke-width="1.75" />
            </button>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between border-t border-brand-border-light pt-4">
        <div class="flex flex-col gap-0.5">
          <p class="text-sm font-semibold text-brand-text">Mostrar línea de tiempo de actividad</p>
          <p class="text-xs text-brand-text-muted">Todavía no hay un historial de actividad real (HU futura) - por ahora solo se ve un aviso.</p>
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
