<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { renderDesignerMarkdown } from '~/utils/designerMarkdown'

const props = defineProps<{ source: string }>()
const ready = ref(false)
onMounted(() => { ready.value = true })
const safeHtml = computed(() => ready.value ? renderDesignerMarkdown(props.source, window) : '')
</script>

<template>
  <div class="designer-markdown max-w-[72ch] break-words text-brand-text-secondary" v-html="safeHtml" />
</template>

<style scoped>
.designer-markdown :deep(> * + *) { margin-top: 0.65rem; }
.designer-markdown :deep(h3) { font-size: 0.875rem; font-weight: 700; color: rgb(var(--brand-designer-markdown-heading)); }
.designer-markdown :deep(ul), .designer-markdown :deep(ol) { padding-left: 1.25rem; }
.designer-markdown :deep(ul) { list-style: disc; }
.designer-markdown :deep(ol) { list-style: decimal; }
.designer-markdown :deep(li + li) { margin-top: 0.35rem; }
.designer-markdown :deep(strong) { font-weight: 700; color: rgb(var(--brand-designer-markdown-heading)); }
.designer-markdown :deep(code) { border-radius: 0.2rem; background: rgb(var(--brand-designer-markdown-code)); padding: 0.1rem 0.25rem; font-size: 0.92em; }
.designer-markdown :deep(pre) { overflow-x: auto; border-radius: 0.35rem; background: rgb(var(--brand-designer-markdown-code)); padding: 0.75rem; }
.designer-markdown :deep(pre code) { padding: 0; background: transparent; }
.designer-markdown :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
.designer-markdown :deep(th), .designer-markdown :deep(td) { border: 1px solid rgb(var(--brand-designer-markdown-border)); padding: 0.35rem 0.55rem; text-align: left; }
.designer-markdown :deep(th) { background: rgb(var(--brand-designer-markdown-code)); font-weight: 700; }
</style>
