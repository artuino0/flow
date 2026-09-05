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

const formValues = ref<Record<string, unknown>>({})
const generalFormRef = ref<{ validateAll: () => boolean } | null>(null)
const tablaFormRefs = ref<Array<{ validateAll: () => boolean } | null>>([])
const submitting = ref(false)
const submitError = ref<string | null>(null)

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
    await $fetch(`/api/records/${slug}`, {
      method: 'POST',
      body: { customData: formValues.value }
    })
    await navigateTo(`/registros/${slug}`)
  } catch (err: any) {
    submitError.value = err?.data?.statusMessage || 'No se pudo crear el registro'
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
      <div class="flex flex-col gap-1">
        <h1 class="text-[22px] font-bold text-brand-text">Nuevo {{ data.entity.singularName || data.entity.name }}</h1>
        <p class="text-sm text-brand-text-secondary">Completa los campos para crear un nuevo registro en la entidad {{ data.entity.singularName || data.entity.name }}.</p>
      </div>

      <p v-if="data.fields.length === 0" class="text-sm text-brand-text-muted">Esta entidad todavía no tiene campos configurados.</p>

      <form v-else class="flex flex-col gap-5" @submit.prevent="onSubmit">
        <div v-if="visibleGeneralFields.length > 0" class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
          <div class="border-b border-brand-border-light p-5">
            <h2 class="text-[15px] font-bold text-brand-text">Información general</h2>
          </div>
          <div class="p-5">
            <DynamicForm ref="generalFormRef" v-model="formValues" :fields="generalFields" :entity-id="data.entity.id" :disabled="submitting" />
          </div>
        </div>

        <div
          v-for="field in tablaFields"
          :key="field.id"
          class="flex flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]"
        >
          <div class="border-b border-brand-border-light p-5">
            <h2 class="text-[15px] font-bold text-brand-text">{{ field.label }}</h2>
            <p class="mt-0.5 text-xs text-brand-text-muted">Agrega las filas que necesites.</p>
          </div>
          <div class="p-5">
            <DynamicForm ref="tablaFormRefs" v-model="formValues" :fields="[field]" :entity-id="data.entity.id" :disabled="submitting" hide-labels />
          </div>
        </div>

        <p v-if="submitError" class="text-sm text-brand-error-text">{{ submitError }}</p>

        <div class="flex justify-end gap-2">
          <NuxtLink
            :to="`/registros/${slug}`"
            class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg"
          >
            Cancelar
          </NuxtLink>
          <button
            type="submit"
            :disabled="submitting"
            class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {{ submitting ? 'Guardando...' : 'Guardar' }}
          </button>
        </div>
      </form>
    </template>
  </div>
</template>
