<script setup lang="ts">
// HU-ERD-23: pagina generica de alta de registro para cualquier entidad -
// arma el formulario a partir de GET /api/entities/:slug/fields (DynamicForm)
// y crea el registro via POST /api/records/:slug. Reemplazable mas adelante
// por las pantallas de modulo especificas (ERD-32) sin cambiar el motor.
//
// Rediseño (2026-09-04, pedido directo del usuario: "no parece la ventana
// como la de pedido... se supone que es una estructura similar"): la pantalla
// que el usuario tenia en mente ("Pedido") nunca existio como pagina real -
// es el mock Screen/Form Pedido (Campo Tabla) del .pen (revisado con las
// herramientas de Pencil antes de este cambio), que jamas se aplico a este
// motor generico. Se toma de ahi: breadcrumb + titulo/subtitulo, los campos
// normales agrupados en una tarjeta "Informacion general", y cada Campo
// Tabla en su PROPIA tarjeta (titulo = label del campo). La logica de
// columna calculada en vivo + fila de Total YA existia en
// DynamicTableField.vue (HU-ERD-72, "Sigue Screen/Form Pedido") - no hacia
// falta tocarla, solo faltaba este empaque visual.
//
// Seguimiento (2026-09-05, pedido directo del usuario: "hay manera de
// calcular el plural? para que en el menu salga Manifiestos, Empaques..."):
// `entity.name` sigue siendo el texto libre de siempre (tipicamente en
// plural - "Empaques", igual que ya se ve en el menu) - "Nuevo {name}" de
// abajo hubiera quedado gramaticalmente mal ("Nuevo Empaques"). Se agrega
// `entity.singularName` (opcional, ver comentario largo en
// server/db/schema.ts) - si esta cargado se usa aca, si no se sigue usando
// `name` tal cual (mismo comportamiento que el dia que se escribio esta
// pagina).
//
// Decision de alcance: el mock agrupa los campos de "Informacion general" en
// filas de 3 columnas - esta pagina los sigue mostrando en una sola columna
// (igual que siempre did DynamicForm.vue) para no reescribir ese componente
// para una sola HU. Tambien se decide NO crear un componente de layout
// compartido con editar.vue (quedan simetricas pero duplicadas), siguiendo el
// mismo criterio que esas dos paginas ya usaban entre si desde ERD-23.

import { Clock } from '@lucide/vue'

definePageMeta({ layout: 'default' })

const route = useRoute()
const slug = route.params.entity as string

const { data, pending, error: fetchError } = await useEntityFields(slug)

// Mismo filtro que renderableFields de DynamicForm.vue (id/incremental nunca
// se piden a mano) - se duplica aca solo para decidir si la tarjeta
// "Informacion general" tiene algo que mostrar, no para renderizar.
const generalFields = computed(() => (data.value?.fields ?? []).filter((f) => f.dataType !== 'tabla'))
const visibleGeneralFields = computed(() => generalFields.value.filter((f) => f.name !== 'id' && f.dataType !== 'incremental'))
const tablaFields = computed(() => (data.value?.fields ?? []).filter((f) => f.dataType === 'tabla'))
// Rediseño (2026-09-05, pedido directo del usuario: "creo que seria mejor
// que las entidades relacionadas se vean a la derecha como un dos columnas,
// la izq menos ancha, unas 4 o algo fijo, lo demas para los de la derecha
// com si fueran cards 100% ancho de las 8"): "Informacion general" pasa a
// una columna izquierda angosta (4/12) y cada Campo Tabla (entidades
// relacionadas) a una columna derecha ancha (8/12), apiladas si hay mas de
// una - antes las dos iban en una sola columna, una arriba de la otra. Sin
// Campos Tabla no tiene sentido angostar "Informacion general" a 4/12 (se
// veria un formulario chico con medio ancho de pantalla vacio) - ahi se
// sigue mostrando a ancho completo, como antes de este cambio.
const hasTablaFields = computed(() => tablaFields.value.length > 0)

const formValues = ref<Record<string, unknown>>({})
const fixedWorkflowValues = computed(() => data.value?.entity.workflowConfig?.enabled ? { [data.value.entity.workflowConfig.field]: data.value.entity.workflowConfig.initial } : {})
const returnTo = computed(() => {
  const from = typeof route.query.from === 'string' ? route.query.from : ''
  return /^\/registros\/[A-Za-z0-9_-]+\/[0-9a-fA-F-]{36}$/.test(from) ? from : `/registros/${slug}`
})
watch(() => data.value?.fields, (fields) => {
  if (!fields?.length) return
  const next = { ...formValues.value }
  let changed = false
  for (const field of fields) {
    const raw = route.query[field.name]
    const value = Array.isArray(raw) ? raw[0] : raw
    const isRelationId = field.dataType === 'relation' && typeof value === 'string' && /^[0-9a-fA-F-]{36}$/.test(value)
    const isCalendarDate = field.name === data.value?.calendarConfig.startDateField && field.dataType === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    const isCalendarTime = field.name === data.value?.calendarConfig.startTimeField && ['text', 'datetime'].includes(field.dataType) && typeof value === 'string'
    if ((isRelationId || isCalendarDate || isCalendarTime) && next[field.name] == null) {
      next[field.name] = value
      changed = true
    }
  }
  if (changed) formValues.value = next
}, { immediate: true })
const generalFormRef = ref<{ validateAll: () => boolean } | null>(null)
const tablaFormRefs = ref<Array<{ validateAll: () => boolean } | null>>([])
const submitting = ref(false)
const submitError = ref<string | null>(null)

// Pedido directo del usuario ("aplica los toast, checa donde deben ir") -
// ver composables/useToast.ts. Toast/Guardado (variante "success") en la
// creacion exitosa - el error tambien se muestra en el toast, ademas del
// mensaje inline ya existente (submitError, que queda por si el toast se
// pierde por un re-render inmediato al navegar).
const toast = useToast()

function validateAll(): boolean {
  const refs = [generalFormRef.value, ...tablaFormRefs.value].filter((r): r is { validateAll: () => boolean } => Boolean(r))
  // .map() en vez de .every() con corto-circuito: hace falta correr
  // validateAll() de TODAS las tarjetas para que cada una muestre sus
  // propios errores, no solo la primera que falle.
  const results = refs.map((r) => r.validateAll())
  return results.every(Boolean)
}

async function onSubmit() {
  submitError.value = null
  if (!validateAll()) return

  submitting.value = true
  try {
    const res = await $fetch<any>(`/api/records/${slug}`, {
      method: 'POST',
      body: { customData: formValues.value }
    })
    toast.success('Registro creado', `Se creó un nuevo registro en ${data.value?.entity?.singularName || data.value?.entity?.name || slug}.`)
    
    // Redirect to the newly created record's detail view
    const newId = res.id
    if (newId) {
      await navigateTo(`/registros/${slug}/${newId}`)
    } else {
      await navigateTo(returnTo.value)
    }
  } catch (err: any) {
    submitError.value = err?.data?.statusMessage || 'No se pudo crear el registro'
    toast.error('No se pudo crear el registro', submitError.value)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex items-center gap-1 text-[13px]">
      <span class="text-brand-text-secondary">Inicio</span>
      <NuxtLink :to="`/registros/${slug}`" class="text-brand-text-secondary hover:underline">{{ data?.entity?.name || slug }}</NuxtLink>
      <span class="text-brand-text-muted">/</span>
      <span class="font-bold text-brand-text">Nuevo</span>
    </div>

    <p v-if="pending" class="text-sm text-brand-text-muted">Cargando formulario...</p>
    <p v-else-if="fetchError" class="text-sm text-brand-error-text">No se pudo cargar la definicion de esta entidad.</p>

    <template v-else-if="data">
      <form class="grid grid-cols-1 gap-5 lg:grid-cols-[360px_1fr]" @submit.prevent="onSubmit">
        <!-- COLUMNA IZQUIERDA: Detalle (Card Form) -->
        <div class="flex flex-col h-fit self-start rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
          <div class="flex flex-col gap-3 border-b border-brand-border-light p-5">
            <div class="flex min-w-0 items-start gap-3">
              <div class="flex min-w-0 flex-col gap-0.5">
                <p class="text-[11px] font-bold uppercase tracking-wide text-brand-text-muted">NUEVO REGISTRO</p>
                <h2 class="break-words text-[17px] font-bold leading-snug text-brand-text">{{ data.entity.singularName || data.entity.name }}</h2>
                <p class="text-xs text-brand-text-muted">Completa los campos para crear la ficha.</p>
              </div>
            </div>
          </div>
          
          <div class="p-5">
            <DynamicForm v-if="visibleGeneralFields.length > 0" ref="generalFormRef" v-model="formValues" :fields="generalFields" :entity-id="data.entity.id" :disabled="submitting" :fixed-values="fixedWorkflowValues" />
            <p v-else class="text-sm text-brand-text-muted">No hay campos generales configurados.</p>
            
            <p v-if="submitError" class="mt-4 text-sm text-brand-error-text">{{ submitError }}</p>

            <div class="mt-6 flex flex-col gap-2">
              <button
                type="submit"
                :disabled="submitting"
                class="w-full rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {{ submitting ? 'Guardando...' : 'Guardar y continuar' }}
              </button>
              <NuxtLink
                :to="returnTo"
                class="w-full text-center rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg"
              >
                Cancelar
              </NuxtLink>
            </div>
          </div>
        </div>

        <!-- COLUMNA DERECHA: Asociaciones / Actividad (Placeholder) -->
        <div class="flex flex-col rounded-lg min-w-0">
          <div class="flex items-center gap-1 border-b border-brand-border-light" role="tablist">
            <button type="button" class="border-b-2 px-4 py-3 text-sm font-semibold border-brand-orange text-brand-text">
              Asociaciones
            </button>
            <button type="button" class="border-b-2 px-4 py-3 text-sm font-semibold border-transparent text-brand-text-muted">
              Actividad
            </button>
          </div>

          <div class="flex flex-col gap-5 pt-5">
            <template v-if="hasTablaFields">
              <div
                v-for="field in tablaFields"
                :key="field.id"
                class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]"
              >
                <div class="border-b border-brand-border-light px-4 py-3">
                  <h3 class="text-sm font-bold text-brand-text">{{ field.label }}</h3>
                </div>
                <div class="p-4">
                  <DynamicForm ref="tablaFormRefs" v-model="formValues" :fields="[field]" :entity-id="data.entity.id" :disabled="submitting" hide-labels />
                </div>
              </div>
            </template>
            
            <div class="flex items-center gap-2 rounded border border-brand-border-light bg-brand-bg p-3 text-xs text-brand-text-secondary">
              <Clock class="h-3.5 w-3.5 shrink-0" :stroke-width="1.75" />
              <span>Guarda el registro a la izquierda para empezar a registrar actividad y vincular otras relaciones.</span>
            </div>
          </div>
        </div>
      </form>
    </template>
  </div>
</template>
