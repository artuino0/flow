<script setup lang="ts">
import { basicSetup } from 'codemirror'
import { Compartment, EditorState } from '@codemirror/state'
import { Decoration, EditorView, keymap, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { sitesCodeBaseTheme, sitesCodeDarkTheme } from '~/utils/sitesCodeTheme'

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

const { resolved } = useTheme()
const themeCompartment = new Compartment()

function agendaDecorations(view: EditorView) {
  const ranges: Array<ReturnType<Decoration['range']>> = []
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to)
    for (const match of text.matchAll(/\{\{\s*(?:agenda-component|openagenda)\b[^}]*\}\}/gi)) ranges.push(Decoration.mark({ class: 'cm-flow-agenda' }).range(from + match.index!, from + match.index! + match[0].length))
  }
  return Decoration.set(ranges, true)
}
const agendaHighlights = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = agendaDecorations(view) }
  update(update: ViewUpdate) { if (update.docChanged || update.viewportChanged) this.decorations = agendaDecorations(update.view) }
}, { decorations: plugin => plugin.decorations })

function insertAgenda(kind: 'inline' | 'open') {
  if (!editor || props.language !== 'html') return false
  const fragment = kind === 'inline' ? '{{agenda-component}}' : '<button {{openAgenda}}>Agenda tu cita</button>'
  editor.dispatch(editor.state.replaceSelection(fragment))
  editor.focus()
  return true
}
defineExpose({ insertAgenda })

function languageExtension(language: 'html' | 'css' | 'js') {
  if (language === 'html') return html({ autoCloseTags: true })
  if (language === 'css') return css()
  // JS era texto plano en claro; el parser instalado se activa solo en oscuro.
  return resolved.value === 'dark' ? javascript() : []
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
        themeCompartment.of(resolved.value === 'dark' ? sitesCodeDarkTheme : []),
        sitesCodeBaseTheme,
        agendaHighlights,
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

watch(resolved, theme => {
  editor?.dispatch({ effects: [
    themeCompartment.reconfigure(theme === 'dark' ? sitesCodeDarkTheme : []),
    languageCompartment.reconfigure(languageExtension(props.language))
  ] })
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
.sites-code-editor {
  position: absolute;
  inset: 0;
  width: auto;
  height: auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: rgb(var(--brand-surface));
}
.sites-code-editor :deep(.cm-editor) {
  height: 100% !important;
  max-height: 100%;
  width: 100%;
  min-height: 0;
  overflow: hidden;
}
.sites-code-editor :deep(.cm-flow-agenda) { font-weight: 700; text-decoration: underline; text-decoration-color: rgb(var(--brand-blue)); text-underline-offset: 3px; }
.sites-code-editor :deep(.cm-scroller) {
  min-height: 0;
  overflow: auto !important;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: rgb(var(--brand-sites-editor-code-scrollbar)) rgb(var(--brand-sites-editor-code-track));
}
.sites-code-editor :deep(.cm-scroller::-webkit-scrollbar) { width: 10px; height: 10px; }
.sites-code-editor :deep(.cm-scroller::-webkit-scrollbar-track) { background: rgb(var(--brand-sites-editor-code-track)); }
.sites-code-editor :deep(.cm-scroller::-webkit-scrollbar-thumb) { border: 2px solid rgb(var(--brand-sites-editor-code-track)); border-radius: 999px; background: rgb(var(--brand-sites-editor-code-scrollbar)); }
.sites-code-editor :deep(.cm-scroller::-webkit-scrollbar-thumb:hover) { background: rgb(var(--brand-sites-editor-code-scrollbar-hover)); }
</style>

