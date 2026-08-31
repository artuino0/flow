<script setup lang="ts">
// HU-ERD-70: modal "Agregar/Editar campo" - sigue Screen/Editor de Campos -
// Agregar Campo del .pen (revisado con las herramientas de Pencil): nombre
// tecnico + etiqueta, 6 tarjetas de tipo (Texto/Numero/Booleano/Fecha/JSON/
// Relacion - los mismos 6 tipos "base" de HU-ERD-17/29, sin tabla/select/
// multiselect de HU-ERD-68 que son alcance de HU-ERD-71), toggle "obligatorio"
// y reglas de validacion segun el tipo elegido.
//
// Reglas de validacion expuestas aca: solo el subset simple que ya soporta
// getValidationRulesSchema() (server/utils/dynamicSchema.ts) con una UI de
// 1-2 campos (text: min/maxLength: number: min/max + enteros; date: min/max) -
// "pattern"/"enum" de texto no tienen UI en este modal (no estan en el
// diseno y una lista de opciones libre se sale del alcance de esta HU).
//
// "Relacion" no tiene reglas de validacion configurables aca a proposito: el
// diseno completo (Screen/Agregar Campo - Relacion 1:N) suma eleccion de
// entidad relacionada, cardinalidad 1:1/1:N y "campos propios de la relacion"
// (equivalente a un editor de columnas tipo tabla) - eso no tiene ningun
// soporte de backend hoy (entity_fields.validation_rules para 'relation' es
// {} vacio) y excede el alcance textual de esta HU; queda para una HU futura
// si se decide construirlo.
import { computed, reactive, watch } from 'vue'
import { Braces, Calendar, Check, Hash, Link2, ToggleLeft, Type as TypeIcon, X } from '@lucide/vue'

export interface FieldDraft {
  name: string
  label: string
  dataType: string
  validationRules: Record<string, unknown>
  isRequired: boolean
}

const props = defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  initialField?: FieldDraft | null
  saving?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  close: []
  submit: [draft: FieldDraft]
}>()

interface TypeOption {
  value: string
  label: string
  icon: typeof TypeIcon
}

const TYPE_OPTIONS: TypeOption[] = [
  { value: 'text', label: 'Texto', icon: TypeIcon },
  { value: 'number', label: 'Número', icon: Hash },
  { value: 'boolean', label: 'Booleano', icon: ToggleLeft },
  { value: 'date', label: 'Fecha', icon: Calendar },
  { value: 'json', label: 'JSON', icon: Braces },
  { value: 'relation', label: 'Relación', icon: Link2 }
]

const form = reactive({
  name: '',
  label: '',
  dataType: 'text',
  isRequired: false,
  minLength: null as number | null,
  maxLength: null as number | null,
  min: null as number | null,
  max: null as number | null,
  integer: false,
  dateMin: '',
  dateMax: ''
})

watch(
  () => [props.open, props.initialField] as const,
  ([open, field]) => {
    if (!open) return
    const rules = (field?.validationRules ?? {}) as Record<string, unknown>
    form.name = field?.name ?? ''
    form.label = field?.label ?? ''
    form.dataType = field?.dataType ?? 'text'
    form.isRequired = field?.isRequired ?? false
    form.minLength = typeof rules.minLength === 'number' ? rules.minLength : null
    form.maxLength = typeof rules.maxLength === 'number' ? rules.maxLength : null
    form.min = typeof rules.min === 'number' ? rules.min : null
    form.max = typeof rules.max === 'number' ? rules.max : null
    form.integer = rules.integer === true
    form.dateMin = typeof rules.min === 'string' ? rules.min : ''
    form.dateMax = typeof rules.max === 'string' ? rules.max : ''
  },
  { immediate: true }
)

function validationRulesForSubmit(): Record<string, unknown> {
  switch (form.dataType) {
    case 'text': {
      const rules: Record<string, unknown> = {}
      if (form.minLength !== null) rules.minLength = form.minLength
      if (form.maxLength !== null) rules.maxLength = form.maxLength
      return rules
    }
    case 'number': {
      const rules: Record<string, unknown> = {}
      if (form.min !== null) rules.min = form.min
      if (form.max !== null) rules.max = form.max
      if (form.integer) rules.integer = true
      return rules
    }
    case 'date': {
      const rules: Record<string, unknown> = {}
      if (form.dateMin) rules.min = form.dateMin
      if (form.dateMax) rules.max = form.dateMax
      return rules
    }
    default:
      return {}
  }
}

const nameError = computed(() => {
  if (!form.name) return null
  return /^[a-z][a-z0-9_]*$/.test(form.name)
    ? null
    : 'Solo minúsculas, números y guion bajo, debe empezar con una letra'
})

const canSubmit = computed(() => form.name.length > 0 && !nameError.value && form.label.length > 0)

function onSubmit() {
  if (!canSubmit.value) return
  emit('submit', {
    name: form.name,
    label: form.label,
    dataType: form.dataType,
    validationRules: validationRulesForSubmit(),
    isRequired: form.isRequired
  })
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="flex max-h-[90vh] w-full max-w-[560px] flex-col overflow-y-auto rounded-lg bg-brand-surface shadow-xl">
      <div class="flex items-start justify-between border-b border-brand-border-light p-5">
        <div class="flex flex-col gap-0.5">
          <h2 class="text-[17px] font-bold text-brand-text">{{ mode === 'create' ? 'Agregar campo' : 'Editar campo' }}</h2>
          <p class="text-sm text-brand-text-secondary">Define las propiedades de este campo</p>
        </div>
        <button type="button" class="flex h-7 w-7 items-center justify-center rounded text-brand-text-muted hover:bg-brand-bg" @click="emit('close')">
          <X class="h-4 w-4" :stroke-width="1.75" />
        </button>
      </div>

      <div class="flex flex-col gap-5 p-5">
        <div class="grid grid-cols-2 gap-4">
          <div class="flex flex-col gap-1.5">
            <label for="field-name" class="text-[13px] font-semibold text-brand-text">Nombre técnico</label>
            <input
              id="field-name"
              v-model="form.name"
              type="text"
              :disabled="mode === 'edit'"
              class="w-full rounded border border-brand-border px-3 py-[9px] font-mono text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue disabled:bg-brand-bg disabled:text-brand-text-muted"
            />
            <p v-if="nameError" class="text-xs text-brand-error-text">{{ nameError }}</p>
            <p v-else class="text-xs text-brand-text-muted">{{ mode === 'edit' ? 'No se puede cambiar una vez creado.' : 'Sin espacios, usado en la API' }}</p>
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="field-label" class="text-[13px] font-semibold text-brand-text">Etiqueta visible</label>
            <input
              id="field-label"
              v-model="form.label"
              type="text"
              class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <p class="text-[13px] font-semibold text-brand-text">Tipo de dato</p>
          <div class="grid grid-cols-3 gap-2.5">
            <button
              v-for="opt in TYPE_OPTIONS"
              :key="opt.value"
              type="button"
              class="relative flex flex-col items-start gap-2 rounded border p-3 text-left"
              :class="form.dataType === opt.value ? 'border-2 border-brand-blue bg-brand-blue-bg' : 'border-brand-border bg-brand-surface'"
              @click="form.dataType = opt.value"
            >
              <Check v-if="form.dataType === opt.value" class="absolute right-2.5 top-2.5 h-[15px] w-[15px] text-brand-blue" :stroke-width="2" />
              <div
                class="flex h-[26px] w-[26px] items-center justify-center rounded"
                :class="form.dataType === opt.value ? 'bg-brand-surface' : 'bg-brand-neutral-bg'"
              >
                <component :is="opt.icon" class="h-3.5 w-3.5" :class="form.dataType === opt.value ? 'text-brand-blue' : 'text-brand-neutral-text'" :stroke-width="1.75" />
              </div>
              <span class="text-[13px]" :class="form.dataType === opt.value ? 'font-bold text-brand-blue' : 'font-semibold text-brand-text'">{{ opt.label }}</span>
            </button>
          </div>
        </div>

        <div class="flex items-center justify-between rounded border border-brand-border-light p-3">
          <div class="flex flex-col gap-0.5">
            <p class="text-sm font-semibold text-brand-text">Campo obligatorio</p>
            <p class="text-xs text-brand-text-muted">El usuario no podrá guardar el registro sin completarlo</p>
          </div>
          <button
            type="button"
            class="flex h-[22px] w-[38px] shrink-0 items-center rounded-full p-[2px] transition-colors"
            :class="form.isRequired ? 'justify-end bg-brand-orange' : 'justify-start border border-brand-border bg-brand-surface'"
            @click="form.isRequired = !form.isRequired"
          >
            <span class="h-[18px] w-[18px] rounded-full bg-white shadow" />
          </button>
        </div>

        <div v-if="form.dataType === 'text'" class="flex flex-col gap-2">
          <p class="text-[13px] font-semibold text-brand-text">Reglas de validación</p>
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
              <label class="text-[13px] font-semibold text-brand-text">Longitud mínima</label>
              <input v-model.number="form.minLength" type="number" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-[13px] font-semibold text-brand-text">Longitud máxima</label>
              <input v-model.number="form.maxLength" type="number" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
            </div>
          </div>
        </div>

        <div v-else-if="form.dataType === 'number'" class="flex flex-col gap-3">
          <p class="text-[13px] font-semibold text-brand-text">Reglas de validación</p>
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
              <label class="text-[13px] font-semibold text-brand-text">Valor mínimo</label>
              <input v-model.number="form.min" type="number" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-[13px] font-semibold text-brand-text">Valor máximo</label>
              <input v-model.number="form.max" type="number" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
            </div>
          </div>
          <label class="flex items-center gap-2 text-sm text-brand-text">
            <input v-model="form.integer" type="checkbox" class="h-[18px] w-[18px] rounded-[3px] border-brand-border text-brand-orange focus:ring-brand-orange" />
            Solo permitir números enteros
          </label>
        </div>

        <div v-else-if="form.dataType === 'date'" class="flex flex-col gap-2">
          <p class="text-[13px] font-semibold text-brand-text">Reglas de validación</p>
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
              <label class="text-[13px] font-semibold text-brand-text">Fecha mínima</label>
              <input v-model="form.dateMin" type="date" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-[13px] font-semibold text-brand-text">Fecha máxima</label>
              <input v-model="form.dateMax" type="date" class="w-full rounded border border-brand-border px-3 py-[9px] text-sm text-brand-text focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
            </div>
          </div>
        </div>

        <p v-if="error" class="text-sm text-brand-error-text">{{ error }}</p>
      </div>

      <div class="flex items-center justify-end gap-3 border-t border-brand-border-light p-5">
        <button type="button" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg" @click="emit('close')">
          Cancelar
        </button>
        <button
          type="button"
          :disabled="!canSubmit || saving"
          class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
          @click="onSubmit"
        >
          {{ saving ? 'Guardando...' : mode === 'create' ? 'Agregar campo' : 'Guardar campo' }}
        </button>
      </div>
    </div>
  </div>
</template>
