<script setup lang="ts">
import type { SiteSeoAudit } from '~/utils/siteSeoAudit'
const props = defineProps<{ audit?: SiteSeoAudit; error?: boolean }>()
const groups = computed(() => [...new Set(props.audit?.items.map(item => item.group) ?? [])])
function focusField(target?: string) { if (target) document.getElementById(target)?.focus() }
</script>
<template>
  <section aria-label="Checklist SEO" class="min-w-0 text-sm text-brand-text">
    <h3 class="font-semibold">Checklist SEO <span v-if="audit" class="font-normal text-brand-text-secondary">{{ audit.ready }} de {{ audit.total }} listos</span></h3>
    <p v-if="error" role="alert">No se pudo analizar. Vuelve a guardar para reintentarlo.</p>
    <p v-else-if="!audit" role="status">Preparando análisis del contenido guardado…</p>
    <p v-else class="mt-2 text-xs text-brand-text-secondary">Se recalcula al guardar. Revisa y publica los cambios para que se vean en tu dominio.</p>
    <details v-for="group in groups" :key="group" class="mt-3 border-b border-brand-border-light pb-3" :open="audit?.items.some(item => item.group === group && item.state === 'falta')">
      <summary class="cursor-pointer font-semibold focus-visible:outline-brand-blue">{{ group }}</summary>
      <ul class="mt-3 space-y-3">
        <li v-for="item in audit?.items.filter(item => item.group === group)" :key="item.id">
          <p><span aria-hidden="true">{{ item.state === 'ok' ? '✓' : item.state === 'falta' ? '○' : '△' }}</span> <strong>{{ item.state === 'ok' ? 'Listo' : item.state === 'falta' ? 'Falta' : 'Aviso' }}:</strong> {{ item.text }}</p>
          <p v-if="item.state !== 'ok'" class="mt-1 text-xs text-brand-text-secondary">{{ item.fix }} <button v-if="item.target" type="button" class="text-brand-blue underline focus-visible:outline-brand-blue" @click="focusField(item.target)">Ir al campo</button></p>
        </li>
      </ul>
    </details>
    <p class="mt-5 text-xs leading-relaxed text-brand-text-secondary">Este checklist cubre lo técnico que depende de tu página. Aparecer en Google también depende de tu contenido, de la competencia, de los enlaces que reciba tu sitio y del tiempo (semanas o meses). Completar el checklist no garantiza una posición. <a href="https://search.google.com/search-console/about" target="_blank" rel="noopener noreferrer" class="text-brand-blue underline">Dar de alta el sitio en Google Search Console</a>.</p>
  </section>
</template>
