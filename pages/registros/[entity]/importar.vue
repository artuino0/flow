<script setup lang="ts">
// HU-ERD-80: importacion masiva de datos (CSV) para cualquier entidad. El CSV
// se parsea COMPLETO en el navegador (papaparse) y se manda como un array de
// filas ya parseadas a POST /api/records/:entity/import - ver
// server/utils/csvImport.ts para las reglas reales de resolucion (columnas
// relation por texto) y validacion (mismo schema Zod dinamico que el alta
// individual).
//
// Diseno: no existe ningun Screen/Importar en el .pen (revisado antes de
// construir, regla pencil-antes-de-frontend) - se construyo siguiendo el
// mismo lenguaje visual de pages/registros/[entity]/nuevo.vue (card, botones,
// colores brand-*) en vez de inventar un estilo nuevo.
import Papa from 'papaparse'
import { ArrowLeft, CloudUpload, FileUp, X } from '@lucide/vue'

definePageMeta({ layout: 'default' })

const route = useRoute()
const slug = route.params.entity as string

const { data: meta, pending: metaPending, error: metaError } = await useEntityFields(slug)

const fileName = ref<string | null>(null)
const parseError = ref<string | null>(null)
const headers = ref<string[]>([])
const rows = ref<Record<string, string>[]>([])

const fieldNames = computed(() => new Set((meta.value?.fields ?? []).map((f) => f.name)))
const unknownColumns = computed(() => headers.value.filter((h) => !fieldNames.value.has(h)))
const missingRequired = computed(() => (meta.value?.fields ?? []).filter((f) => f.isRequired && !headers.value.includes(f.name)))

interface ImportResult {
  insertedCount: number
  errors: { row: number; error: string }[]
}
const importing = ref(false)
const importError = ref<string | null>(null)
const importResult = ref<ImportResult | null>(null)

function resetImportState() {
  parseError.value = null
  headers.value = []
  rows.value = []
  importResult.value = null
  importError.value = null
}

function clearFile() {
  fileName.value = null
  resetImportState()
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  resetImportState()
  if (!file) return

  fileName.value = file.name
  Papa.parse<Record<string, string>>(file, {
    header: true,
    skipEmptyLines: true,
    complete: (result) => {
      if (result.errors.length > 0) {
        parseError.value = result.errors[0].message
        return
      }
      headers.value = result.meta.fields ?? []
      rows.value = result.data
    },
    error: (err: Error) => {
      parseError.value = err.message
    }
  })
  // Permite volver a elegir el mismo archivo despues de "Importar otro archivo".
  input.value = ''
}

async function onImport() {
  importError.value = null
  importResult.value = null
  importing.value = true
  try {
    importResult.value = await $fetch<ImportResult>(`/api/records/${slug}/import`, {
      method: 'POST',
      body: { rows: rows.value }
    })
  } catch (err: any) {
    importError.value = err?.data?.statusMessage || 'No se pudo importar el archivo'
  } finally {
    importing.value = false
  }
}

const previewRows = computed(() => rows.value.slice(0, 5))
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-4">
    <NuxtLink :to="`/registros/${slug}`" class="flex w-fit items-center gap-1 text-sm font-semibold text-brand-text-secondary hover:text-brand-text">
      <ArrowLeft class="h-4 w-4" :stroke-width="1.75" />
      Volver
    </NuxtLink>

    <div class="rounded-lg border border-brand-border-light bg-brand-surface p-6 shadow-[0_1px_3px_0_#33475B14]">
      <h1 class="text-lg font-bold text-brand-text">Importar{{ meta?.entity?.name ? ` - ${meta.entity.name}` : '' }}</h1>
      <p class="mt-1 text-sm text-brand-text-muted">
        Sube un archivo CSV con encabezados que coincidan con el nombre técnico de los campos. Las columnas de tipo relación
        deben llevar el nombre del registro relacionado como texto, no su id.
      </p>

      <p v-if="metaPending" class="mt-4 text-sm text-brand-text-muted">Cargando...</p>
      <p v-else-if="metaError" class="mt-4 text-sm text-brand-error-text">No se pudo cargar la definición de esta entidad.</p>

      <template v-else-if="meta">
        <div class="mt-4">
          <label
            v-if="!fileName"
            class="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-brand-border px-6 py-10 text-center hover:bg-brand-bg"
          >
            <CloudUpload class="h-6 w-6 text-brand-text-muted" :stroke-width="1.5" />
            <span class="text-sm font-semibold text-brand-text">Arrastra un CSV o haz clic para elegirlo</span>
            <span class="text-xs text-brand-text-muted">Solo archivos .csv</span>
            <input type="file" accept=".csv,text/csv" class="hidden" @change="onFileChange" />
          </label>

          <div v-else class="flex items-center justify-between rounded-lg border border-brand-border-light px-4 py-3">
            <span class="flex items-center gap-2 text-sm font-semibold text-brand-text">
              <FileUp class="h-4 w-4 text-brand-text-muted" :stroke-width="1.75" />
              {{ fileName }}
            </span>
            <button type="button" class="text-brand-text-muted hover:text-brand-text" @click="clearFile">
              <X class="h-4 w-4" :stroke-width="1.75" />
            </button>
          </div>
        </div>

        <p v-if="parseError" class="mt-3 text-sm text-brand-error-text">{{ parseError }}</p>

        <template v-if="rows.length > 0">
          <div class="mt-4 flex flex-col gap-2">
            <p class="text-sm text-brand-text-secondary">
              {{ rows.length }} fila{{ rows.length === 1 ? '' : 's' }} detectada{{ rows.length === 1 ? '' : 's' }}. Vista previa de las primeras
              {{ previewRows.length }}:
            </p>

            <div class="overflow-x-auto rounded border border-brand-border-light">
              <table class="w-full text-left text-sm">
                <thead class="bg-brand-bg">
                  <tr>
                    <th v-for="h in headers" :key="h" class="px-3 py-2 font-semibold text-brand-text-secondary">{{ h }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, i) in previewRows" :key="i" class="border-t border-brand-border-light">
                    <td v-for="h in headers" :key="h" class="px-3 py-2 text-brand-text">{{ row[h] }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p v-if="unknownColumns.length > 0" class="text-xs text-brand-text-muted">
              Estas columnas no coinciden con ningún campo de la entidad y se ignorarán: {{ unknownColumns.join(', ') }}
            </p>
            <p v-if="missingRequired.length > 0" class="text-xs text-brand-error-text">
              Faltan columnas obligatorias: {{ missingRequired.map((f) => f.label).join(', ') }}
            </p>
          </div>

          <div class="mt-4 flex justify-end">
            <button
              type="button"
              :disabled="importing || missingRequired.length > 0"
              class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover disabled:cursor-not-allowed disabled:opacity-60"
              @click="onImport"
            >
              {{ importing ? 'Importando...' : `Importar ${rows.length} fila${rows.length === 1 ? '' : 's'}` }}
            </button>
          </div>
        </template>

        <p v-if="importError" class="mt-3 text-sm text-brand-error-text">{{ importError }}</p>

        <div v-if="importResult" class="mt-5 rounded-lg border border-brand-border-light p-4">
          <p class="text-sm font-semibold text-brand-text">
            {{ importResult.insertedCount }} registro{{ importResult.insertedCount === 1 ? '' : 's' }} importado{{
              importResult.insertedCount === 1 ? '' : 's'
            }}{{ importResult.errors.length > 0 ? `, ${importResult.errors.length} con error` : '' }}
          </p>

          <div v-if="importResult.errors.length > 0" class="mt-3 overflow-x-auto rounded border border-brand-border-light">
            <table class="w-full text-left text-sm">
              <thead class="bg-brand-bg">
                <tr>
                  <th class="px-3 py-2 font-semibold text-brand-text-secondary">Fila</th>
                  <th class="px-3 py-2 font-semibold text-brand-text-secondary">Error</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in importResult.errors" :key="e.row" class="border-t border-brand-border-light">
                  <td class="px-3 py-2 text-brand-text">{{ e.row }}</td>
                  <td class="px-3 py-2 text-brand-error-text">{{ e.error }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="mt-4 flex justify-end gap-2">
            <button
              type="button"
              class="rounded border border-brand-border px-4 py-2 text-sm font-semibold text-brand-text hover:bg-brand-bg"
              @click="clearFile"
            >
              Importar otro archivo
            </button>
            <NuxtLink :to="`/registros/${slug}`" class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:bg-brand-orange-hover">
              Ver registros
            </NuxtLink>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
