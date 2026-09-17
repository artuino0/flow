<script setup lang="ts">
// HU-ERD-23: Form Builder dinamico - renderiza un input por cada entity_field
// segun su dataType/validationRules, sin desarrollo especifico por formulario.
// Tipos soportados: text (+ enum), number, boolean, date, json, tabla
// (ERD-72, delegado a DynamicTableField.vue), select/multiselect (ERD-73,
// delegado a DynamicSelectField.vue), relation (ERD-7/17, buscador con
// autocomplete delegado a DynamicRelationField.vue - ver comentario largo
// ahi, 2026-09-01) y file (ERD-78, subida/descarga delegada a
// DynamicFileField.vue) - todos demasiado complejos (dropdown propio, chips,
// autocomplete, subida de archivos) para vivir inline en este archivo.
import type { EntityFieldMeta } from '~/composables/useEntityFields'

const props = defineProps<{
  fields: EntityFieldMeta[]
  modelValue: Record<string, unknown>
  // HU-ERD-78: requerido por DynamicFileField.vue (POST /api/files?entityId=...
  // necesita saber a que entidad se sube el archivo, ANTES de que el record
  // exista - ver comentario largo en server/db/schema.ts). Todas las paginas
  // que usan DynamicForm.vue ya resuelven la entidad completa (useEntityFields),
  // asi que pasar su id es directo.
  entityId: string
  disabled?: boolean
  // Pedido directo del usuario (2026-09-04, "no parece la ventana como la de
  // pedido"): pages/registros/[entity]/nuevo.vue y .../[id]/editar.vue ahora
  // arman una tarjeta propia por cada Campo Tabla (fiel a Screen/Form Pedido
  // (Campo Tabla) del .pen) con el label del campo como titulo de la tarjeta
  // - pasarle a esa tarjeta un DynamicForm con un solo campo (el Tabla)
  // mostraria el mismo label DOS veces (titulo de tarjeta + label de arriba
  // del campo). En vez de duplicar aca el switch de tipos de dynamicSchema.ts
  // (que ya vive en este archivo) solo para el caso Tabla, se agrega esta
  // bandera generica que oculta el bloque <label> - no cambia nada para el
  // resto de usos (ModulePreviewCard.vue, "Informacion general") porque
  // queda sin usar (undefined) ahi.
  hideLabels?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>]
}>()

const errors = ref<Record<string, string>>({})

// Reportado por el usuario (2026-09-03): GET /api/entities/:entity/fields
// ahora siempre antepone un campo sintetico "id" a props.fields (ver el
// comentario largo en fields.get.ts) para que ModuleFieldsCard.vue lo pinte
// como "Automático"/"Reservado" - pero records.id ya lo genera Postgres solo
// (nunca vive en custom_data), asi que el formulario REAL de crear/editar un
// registro nunca debe pedirlo a mano ni validarlo. Mismo filtro en
// ModulePreviewCard.vue, que renderiza este mismo formulario en el asistente.
//
// Pedido directo del usuario (2026-09-04): un campo 'incremental' es "100%
// automatico y de solo lectura, nunca editable a mano" - mismo criterio que
// "id" de arriba (nunca se pide al usuario, nunca se manda en el submit), asi
// que se excluye aca igual. A diferencia de "id" (nunca aparece en ningun
// otro lado del formulario), el valor YA generado de un incremental SI se ve
// despues, en la ficha de detalle (RecordDetailView.vue) y en el listado
// (DynamicTable.vue) - solo no en este formulario de crear/editar.
const renderableFields = computed(() => props.fields.filter((f) => f.name !== 'id' && f.dataType !== 'incremental'))

function valueFor(name: string): unknown {
  return props.modelValue[name]
}

// Para binds de :value en el template - siempre string, evita el quirk de
// TS al tipar `unknown ?? ''` (NonNullable<unknown> colapsa a "{}").
function displayValue(name: string): string {
  const v = props.modelValue[name]
  return v === null || v === undefined ? '' : String(v)
}

function setValue(name: string, value: unknown) {
  emit('update:modelValue', { ...props.modelValue, [name]: value })
}

function onInput(field: EntityFieldMeta, raw: unknown) {
  let value: unknown = raw
  if (field.dataType === 'number' && raw !== '') value = Number(raw)
  if (field.dataType === 'number' && raw === '') value = null
  if (field.dataType === 'currency' && raw === '') value = null
  setValue(field.name, value)
}

function validateAll(): boolean {
  const nextErrors: Record<string, string> = {}
  for (const field of renderableFields.value) {
    const result = validateFieldValue(field, valueFor(field.name))
    if (!result.valid) nextErrors[field.name] = result.error!
  }
  errors.value = nextErrors
  return Object.keys(nextErrors).length === 0
}

defineExpose({ validateAll })
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-for="field in renderableFields" :key="field.id" class="flex flex-col gap-1.5">
      <label v-if="!hideLabels" :for="`field-${field.name}`" class="text-[13px] font-semibold text-brand-text">
        {{ field.label }}
        <span v-if="field.isRequired" class="text-brand-error-text">*</span>
      </label>

      <!-- text con enum -> select -->
      <select
        v-if="field.dataType === 'text' && Array.isArray(field.validationRules?.enum)"
        :id="`field-${field.name}`"
        :disabled="disabled"
        class="w-full rounded border px-3 py-[9px] text-sm text-brand-text focus:outline-none focus:ring-1 focus:ring-brand-blue"
        :class="errors[field.name] ? 'border-brand-error-text' : 'border-brand-border focus:border-brand-blue'"
        :value="displayValue(field.name)"
        @change="onInput(field, ($event.target as HTMLSelectElement).value)"
      >
        <option value="" disabled>Seleccionar...</option>
        <option v-for="opt in (field.validationRules!.enum as string[])" :key="opt" :value="opt">{{ opt }}</option>
      </select>

      <!-- text simple -->
      <input
        v-else-if="field.dataType === 'text'"
        :id="`field-${field.name}`"
        type="text"
        :disabled="disabled"
        :maxlength="(field.validationRules?.maxLength as number) || undefined"
        class="w-full rounded border px-3 py-[9px] text-sm text-brand-text placeholder:text-brand-text-muted focus:outline-none focus:ring-1 focus:ring-brand-blue"
        :class="errors[field.name] ? 'border-brand-error-text' : 'border-brand-border focus:border-brand-blue'"
        :value="displayValue(field.name)"
        @input="onInput(field, ($event.target as HTMLInputElement).value)"
      />

      <!-- number -->
      <input
        v-else-if="field.dataType === 'number'"
        :id="`field-${field.name}`"
        type="number"
        :disabled="disabled"
        :min="field.validationRules?.min as number"
        :max="field.validationRules?.max as number"
        :step="field.validationRules?.integer ? 1 : 'any'"
        class="w-full rounded border px-3 py-[9px] text-sm text-brand-text focus:outline-none focus:ring-1 focus:ring-brand-blue"
        :class="errors[field.name] ? 'border-brand-error-text' : 'border-brand-border focus:border-brand-blue'"
        :value="displayValue(field.name)"
        @input="onInput(field, ($event.target as HTMLInputElement).value)"
      />

      <!-- currency: conserva el decimal como texto canónico para no perder
           centavos por aritmética de punto flotante. -->
      <div v-else-if="field.dataType === 'currency'" class="relative">
        <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-semibold text-brand-text-secondary">{{ currencyCode(field.validationRules) }}</span>
        <input
          :id="`field-${field.name}`"
          type="number"
          inputmode="decimal"
          :disabled="disabled"
          :min="field.validationRules?.allowNegative ? (field.validationRules?.min as number) : Math.max(0, Number(field.validationRules?.min ?? 0))"
          :max="field.validationRules?.max as number"
          :step="1 / Math.pow(10, currencyDecimals(field.validationRules))"
          class="w-full rounded border py-[9px] pl-14 pr-3 text-right tabular-nums text-sm text-brand-text focus:outline-none focus:ring-1 focus:ring-brand-blue"
          :class="errors[field.name] ? 'border-brand-error-text' : 'border-brand-border focus:border-brand-blue'"
          :value="displayValue(field.name)"
          placeholder="0.00"
          @input="onInput(field, ($event.target as HTMLInputElement).value)"
        />
      </div>

      <!-- boolean -->
      <label v-else-if="field.dataType === 'boolean'" class="flex items-center gap-2 text-sm text-brand-text">
        <input
          :id="`field-${field.name}`"
          type="checkbox"
          :disabled="disabled"
          :checked="Boolean(valueFor(field.name))"
          class="h-[18px] w-[18px] rounded-[3px] border-brand-border text-brand-orange focus:ring-brand-orange"
          @change="onInput(field, ($event.target as HTMLInputElement).checked)"
        />
        <span>Si</span>
      </label>

      <!-- date -->
      <input
        v-else-if="field.dataType === 'date'"
        :id="`field-${field.name}`"
        type="date"
        :disabled="disabled"
        :min="field.validationRules?.min as string"
        :max="field.validationRules?.max as string"
        class="w-full rounded border px-3 py-[9px] text-sm text-brand-text focus:outline-none focus:ring-1 focus:ring-brand-blue"
        :class="errors[field.name] ? 'border-brand-error-text' : 'border-brand-border focus:border-brand-blue'"
        :value="displayValue(field.name)"
        @input="onInput(field, ($event.target as HTMLInputElement).value)"
      />

      <!-- json -->
      <textarea
        v-else-if="field.dataType === 'json'"
        :id="`field-${field.name}`"
        rows="4"
        :disabled="disabled"
        placeholder="{}"
        class="w-full rounded border px-3 py-[9px] font-mono text-sm text-brand-text focus:outline-none focus:ring-1 focus:ring-brand-blue"
        :class="errors[field.name] ? 'border-brand-error-text' : 'border-brand-border focus:border-brand-blue'"
        :value="displayValue(field.name)"
        @input="onInput(field, ($event.target as HTMLTextAreaElement).value)"
      />

      <!-- select/multiselect: HU-ERD-73, ver components/DynamicSelectField.vue -->
      <DynamicSelectField
        v-else-if="field.dataType === 'select' || field.dataType === 'multiselect'"
        :field="field"
        :model-value="valueFor(field.name)"
        :disabled="disabled"
        @update:model-value="(value) => setValue(field.name, value)"
      />

      <!-- tabla: HU-ERD-72, ver components/DynamicTableField.vue -->
      <DynamicTableField
        v-else-if="field.dataType === 'tabla'"
        :field="field"
        :model-value="(valueFor(field.name) as Record<string, unknown>[]) ?? []"
        :disabled="disabled"
        @update:model-value="(rows) => setValue(field.name, rows)"
      />

      <!-- relation: id de otro record - buscador con autocomplete, ver components/DynamicRelationField.vue -->
      <DynamicRelationField
        v-else-if="field.dataType === 'relation'"
        :field="field"
        :model-value="valueFor(field.name)"
        :disabled="disabled"
        @update:model-value="(value) => setValue(field.name, value)"
      />

      <!-- file: HU-ERD-78, ver components/DynamicFileField.vue -->
      <DynamicFileField
        v-else-if="field.dataType === 'file'"
        :field="field"
        :model-value="valueFor(field.name)"
        :entity-id="entityId"
        :disabled="disabled"
        @update:model-value="(value) => setValue(field.name, value)"
      />

      <!-- tipo desconocido: fallback texto -->
      <input
        v-else
        :id="`field-${field.name}`"
        type="text"
        :disabled="disabled"
        class="w-full rounded border px-3 py-[9px] text-sm text-brand-text focus:outline-none focus:ring-1 focus:ring-brand-blue"
        :class="errors[field.name] ? 'border-brand-error-text' : 'border-brand-border focus:border-brand-blue'"
        :value="displayValue(field.name)"
        @input="onInput(field, ($event.target as HTMLInputElement).value)"
      />

      <p v-if="errors[field.name]" class="flex items-center gap-1 text-xs text-brand-error-text">{{ errors[field.name] }}</p>
    </div>
  </div>
</template>
