<script setup lang="ts">
import { basicSetup } from 'codemirror'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'

const props = defineProps<{
  modelValue: string
  language: 'html' | 'css' | 'js'
  ariaLabel: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const host = ref<HTMLElement | null>(null)
let editor: EditorView | null = null
let applyingExternalValue = false
let resizeObserver: ResizeObserver | null = null
const languageCompartment = new Compartment()

const flowTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: '#ffffff',
    color: '#33475b',
    fontSize: '13px'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    lineHeight: '1.65',
    overflow: 'auto',
    scrollbarGutter: 'stable',
    scrollbarWidth: 'thin',
    scrollbarColor: '#aebdca #f3f6f8'
  },
  '.cm-content': { padding: '14px 0', caretColor: '#0091ae' },
  '.cm-line': { padding: '0 18px 0 8px' },
  '.cm-gutters': {
    backgroundColor: '#f7f9fb',
    color: '#8da1b5',
    borderRight: '1px solid #e5eaf0',
    paddingLeft: '6px'
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#f0f7f9' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#ccebf1 !important' },
  '.cm-cursor': { borderLeftColor: '#0091ae' },
  '.cm-searchMatch': { backgroundColor: '#fff2c7', outline: '1px solid #e2b93b' },
  '.cm-tooltip': { border: '1px solid #cbd6e2', borderRadius: '6px', overflow: 'hidden' }
})

function languageExtension(language: 'html' | 'css' | 'js') {
  if (language === 'html') return html({ autoCloseTags: true })
  if (language === 'css') return css()
  return []
}

onMounted(async () => {
  await nextTick()
  if (!host.value) return
  editor = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        languageCompartment.of(languageExtension(props.language)),
        flowTheme,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': props.ariaLabel }),
        EditorView.updateListener.of(update => {
          if (!update.docChanged || applyingExternalValue) return
          emit('update:modelValue', update.state.doc.toString())
        })
      ]
    })
  })
  resizeObserver = new ResizeObserver(() => editor?.requestMeasure())
  resizeObserver.observe(host.value)
  requestAnimationFrame(() => editor?.requestMeasure())
})

watch(() => props.language, language => {
  editor?.dispatch({ effects: languageCompartment.reconfigure(languageExtension(language)) })
})

watch(() => props.modelValue, value => {
  if (!editor || editor.state.doc.toString() === value) return
  applyingExternalValue = true
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
  applyingExternalValue = false
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  editor?.destroy()
  editor = null
})
</script>

<template>
  <div ref="host" class="sites-code-editor" />
</template>

<style scoped>
.sites-code-editor { position: relative; display: block; width: 100%; height: 0; min-width: 0; min-height: 0; flex: 1 1 0; overflow: hidden; background: #fff; }
.sites-code-editor :deep(.cm-editor) { position: absolute; inset: 0; width: 100%; height: auto; }
.sites-code-editor :deep(.cm-scroller) { height: 100%; overflow: auto !important; scrollbar-gutter: stable; scrollbar-width: thin; scrollbar-color: #aebdca #f3f6f8; }
.sites-code-editor :deep(.cm-scroller::-webkit-scrollbar) { width: 10px; height: 10px; }
.sites-code-editor :deep(.cm-scroller::-webkit-scrollbar-track) { background: #f3f6f8; }
.sites-code-editor :deep(.cm-scroller::-webkit-scrollbar-thumb) { border: 2px solid #f3f6f8; border-radius: 999px; background: #aebdca; }
.sites-code-editor :deep(.cm-scroller::-webkit-scrollbar-thumb:hover) { background: #8298aa; }
</style>

