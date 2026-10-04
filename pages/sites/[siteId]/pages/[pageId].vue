<script setup lang="ts">
import { ArrowLeft, Check, Code2, Eye, FileCode2, Laptop, Maximize2, Minus, Monitor, MoreVertical, PanelRight, Plus, Rocket, Save, Smartphone, Tablet, WandSparkles } from '@lucide/vue'
import { buildAgendaEditorPreview, type AgendaEditorPreviewState } from '~/utils/sitesAgendaPreview'
import { joinSiteScript, splitSiteScript } from '~/utils/sitesEditorScript'

definePageMeta({ darkReady: true, layout: 'default', editorFullscreen: true, fullBleed: true })
interface Draft { id: string; version: number; html: string; css: string; updatedAt: string }
interface PageDetail { id: string; title: string; path: string; kind: 'website' | 'landing'; status: string; draft: Draft | null; versions: Array<{ id: string; version: number; status: string; updatedAt: string }>; agendaWarnings?: string[]; agendaPreview?: AgendaEditorPreviewState }

const route = useRoute()
const siteId = route.params.siteId as string
const pageId = route.params.pageId as string
const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { data: page, error, refresh } = await useFetch<PageDetail>(() => `/api/sites/${siteId}/pages/${pageId}`, { headers })
const form = reactive({ title: '', path: '', html: '', css: '', js: '' })
const activeFile = ref<'html' | 'css' | 'js'>('html')
const codeEditor = ref<{ insertAgenda: (kind: 'inline' | 'open') => boolean } | null>(null)
async function insertAgenda(kind: 'inline' | 'open') {
  formsPanel.value?.closeConnection()
  activeFile.value = 'html'; workspace.value = 'split'; connectionOpen.value = false
  await nextTick()
  if (!codeEditor.value?.insertAgenda(kind)) form.html += '\n' + (kind === 'inline' ? '{{agenda-component}}' : '<button {{openAgenda}}>Agenda tu cita</button>')
}
const workspace = ref<'code' | 'split' | 'preview'>('split')
const viewport = ref<'desktop' | 'tablet' | 'mobile'>('desktop')
const previewZoom = ref(100)
const sidebarPanel = usePanelWidth({ storageKey: 'flow-sites-sidebar-width', defaultValue: 250, min: 215, max: 340 })
const codePanel = usePanelWidth({ storageKey: 'flow-sites-code-percent', defaultValue: 50, min: 28, max: 72, step: 2 })
const sidebarWidth = sidebarPanel.width
const codePercent = codePanel.width
const editorBody = ref<HTMLElement | null>(null)
const previewFrame = ref<HTMLIFrameElement | null>(null)
const formsPanel = ref<{ reload: () => Promise<void>; closeConnection: () => void } | null>(null)
const connectionOpen = ref(false)
const previewSelection = ref<{ formKey?: string; fieldName?: string }>({})
const saving = ref(false)
const publishing = ref(false)
const formatting = ref(false)
const saved = ref(false)
const snapshot = ref('')
const toast = useToast()

function hydrate(value: PageDetail) {
  const { html, js } = splitSiteScript(value.draft?.html ?? '')
  form.title = value.title
  form.path = value.path
  form.html = html
  form.css = value.draft?.css ?? ''
  form.js = js
  snapshot.value = JSON.stringify(form)
}
watch(page, value => { if (value) hydrate(value) }, { immediate: true })
const dirty = computed(() => Boolean(snapshot.value) && snapshot.value !== JSON.stringify(form))
const activeCode = computed({ get: () => form[activeFile.value], set: value => { form[activeFile.value] = value } })
const pathEditor = computed({
  get: () => form.path.replace(/^\/+/, ''),
  set: value => { form.path = `/${value.replace(/^\/+/, '')}` }
})
const lineCount = computed(() => Math.max(1, activeCode.value.split('\n').length))
const returnPath = computed(() => `/sites/${siteId}/${page.value?.kind === 'landing' ? 'landing-pages' : 'pages'}`)
const previewWidth = computed(() => viewport.value === 'mobile' ? 390 : viewport.value === 'tablet' ? 768 : 1440)
function serializedHtml() {
  return joinSiteScript(form.html, form.js)
}
const previewDocument = computed(() => buildAgendaEditorPreview(serializedHtml(), form.css, siteId, page.value?.agendaPreview))
const previewTransform = computed(() => ({ width: `${previewWidth.value}px`, height: `${10000 / previewZoom.value}%`, transform: `scale(${previewZoom.value / 100})`, transformOrigin: 'top center' }))

async function save() {
  if (!dirty.value) return true
  if (saving.value) return false
  saving.value = true
  saved.value = false
  try {
    await $fetch(`/api/sites/${siteId}/pages/${pageId}`, { method: 'PUT', body: { title: form.title, path: form.path, html: serializedHtml(), css: form.css } })
    await refresh()
    snapshot.value = JSON.stringify(form)
    saved.value = true
    toast.updated('Borrador guardado', 'La página y sus formularios fueron actualizados.')
    return true
  } catch (err: any) {
    toast.error('No se pudo guardar', err?.data?.statusMessage)
    return false
  } finally { saving.value = false }
}
async function rescanForms() {
  if (!await save()) return
  await formsPanel.value?.reload()
  toast.success('HTML analizado', 'La lista de formularios está actualizada.')
}
async function publishPage() {
  if (publishing.value || saving.value) return
  publishing.value = true
  try {
    if (dirty.value && !await save()) return
    await $fetch(`/api/sites/${siteId}/pages/${pageId}/publish`, { method: 'POST' })
    await refresh()
    if (page.value) hydrate(page.value)
    toast.success('Página publicada', 'La versión publicada ya está disponible.')
  } catch (err: any) {
    toast.error('No se pudo publicar', err?.data?.statusMessage)
  } finally { publishing.value = false }
}
async function formatCode() {
  formatting.value = true
  try {
    const prettier = await import('prettier/standalone')
    const plugins = activeFile.value === 'html'
      ? [(await import('prettier/plugins/html')).default]
      : activeFile.value === 'css'
        ? [(await import('prettier/plugins/postcss')).default]
        : [(await import('prettier/plugins/babel')).default, (await import('prettier/plugins/estree')).default]
    activeCode.value = await prettier.format(activeCode.value, { parser: activeFile.value === 'js' ? 'babel' : activeFile.value, plugins, tabWidth: 2, useTabs: false, printWidth: 100 })
    toast.success('Código formateado', `${activeFile.value.toUpperCase()} quedó ordenado.`)
  } catch {
    toast.error('No se pudo formatear', 'Revisa que el código no tenga una estructura incompleta.')
  } finally { formatting.value = false }
}
function persistWidths() {
  sidebarPanel.persist()
  codePanel.persist()
}
function measureSidebar(clientX: number, startValue: number) {
  const bounds = editorBody.value?.getBoundingClientRect()
  return bounds ? clientX - bounds.left : startValue
}
function measureWorkspace(clientX: number, startValue: number) {
  const bounds = editorBody.value?.getBoundingClientRect()
  if (!bounds) return startValue
  const workspaceLeft = bounds.left + sidebarWidth.value + 5
  const available = Math.max(1, bounds.right - workspaceLeft)
  return ((clientX - workspaceLeft) / available) * 100
}
function zoomBy(delta: number) { previewZoom.value = Math.min(125, Math.max(50, previewZoom.value + delta)) }
function selectFile(file: 'html' | 'css' | 'js') {
  activeFile.value = file
  formsPanel.value?.closeConnection()
  connectionOpen.value = false
  if (workspace.value === 'preview') workspace.value = 'split'
}
function sendPreviewSelection() {
  previewFrame.value?.contentWindow?.postMessage({ source: 'flow-sites-editor', ...previewSelection.value }, '*')
}
function focusPreviewForm(formKey?: string) {
  previewSelection.value = formKey ? { formKey } : {}
  nextTick(sendPreviewSelection)
}
function focusPreviewField(formKey: string, fieldName: string) {
  previewSelection.value = { formKey, fieldName }
  nextTick(sendPreviewSelection)
}
function onAgendaPreviewMessage(event: MessageEvent) {
  if (event.source === previewFrame.value?.contentWindow && event.data?.source === 'flow-sites-agenda-preview' && event.data.action === 'configure') void navigateTo(`/sites/${encodeURIComponent(siteId)}/agenda`)
}
function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
}
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value) event.preventDefault() }
onMounted(() => {
  window.addEventListener('message', onAgendaPreviewMessage)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', beforeUnload)
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onAgendaPreviewMessage)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<template>
  <div class="site-ide">
    <header class="editor-header">
      <div class="page-identity">
        <NuxtLink :to="returnPath" class="back-button" aria-label="Volver a las páginas"><ArrowLeft /></NuxtLink>
        <div class="page-fields">
          <div class="title-line"><input v-model="form.title" aria-label="Título de la página"><span class="status-chip" :class="{ published: page?.status === 'published' }">{{ page?.status === 'published' ? 'Publicada' : 'Borrador' }}</span></div>
          <div class="path-line"><span>/</span><input v-model="pathEditor" aria-label="Ruta de la página" placeholder=""><b>v{{ page?.draft?.version || 1 }}</b></div>
        </div>
      </div>
      <div class="header-actions">
        <details class="relative"><summary class="flex h-8 cursor-pointer items-center rounded border border-brand-control-border bg-brand-surface px-3 text-[10px] font-bold text-brand-text">Insertar agenda</summary><div class="absolute right-0 z-50 mt-2 grid min-w-44 gap-2 rounded border border-brand-border-light bg-brand-surface p-3 text-xs text-brand-text"><button type="button" @click="insertAgenda('inline')">Componente incrustado</button><button type="button" @click="insertAgenda('open')">Botón para abrir modal</button></div></details>
        <span v-if="dirty" class="save-state dirty"><i />Cambios sin guardar</span>
        <span v-else-if="saved" class="save-state saved"><Check />Guardado</span>
        <button type="button" class="ghost-button preview-action" @click="workspace = 'preview'"><Eye />Vista previa</button>
        <button type="button" class="ghost-button" :disabled="saving || publishing || !dirty" @click="save"><Save />{{ saving ? 'Guardando…' : 'Guardar' }}</button>
        <button type="button" class="publish-button" :disabled="saving || publishing" @click="publishPage"><Rocket />{{ publishing ? 'Publicando…' : 'Publicar' }}</button>
        <button type="button" class="more-button" aria-label="Más acciones"><MoreVertical /></button>
      </div>
    </header>

    <div v-if="error" class="load-error">No se encontró la página o ya no tienes acceso.</div>
    <template v-else-if="page">
      <ul v-if="page.agendaWarnings?.length" role="status" class="max-h-28 shrink-0 overflow-auto bg-brand-warning-bg p-3 text-xs text-brand-warning-text"><li v-for="warning in page.agendaWarnings" :key="warning">{{ warning }}</li></ul>
      <div class="editor-toolbar">
        <div class="segmented" aria-label="Vista del editor"><button type="button" :class="{ active: workspace === 'code' }" @click="workspace = 'code'"><Code2 />Código</button><button type="button" :class="{ active: workspace === 'split' }" @click="workspace = 'split'"><PanelRight />Dividida</button><button type="button" :class="{ active: workspace === 'preview' }" @click="workspace = 'preview'"><Eye />Vista previa</button></div>
        <div class="toolbar-center"><span><FileCode2 />{{ activeFile === 'html' ? 'index.html' : activeFile === 'css' ? 'styles.css' : 'site.js' }}</span><span>{{ lineCount }} líneas</span><button v-if="workspace !== 'preview' && !connectionOpen" type="button" :disabled="formatting" @click="formatCode"><WandSparkles />{{ formatting ? 'Formateando…' : 'Formatear' }}</button></div>
        <div class="toolbar-right" v-if="workspace !== 'code'">
          <div class="segmented icon-segment"><button type="button" title="Escritorio" :class="{ active: viewport === 'desktop' }" @click="viewport = 'desktop'"><Monitor /></button><button type="button" title="Tablet" :class="{ active: viewport === 'tablet' }" @click="viewport = 'tablet'"><Tablet /></button><button type="button" title="Móvil" :class="{ active: viewport === 'mobile' }" @click="viewport = 'mobile'"><Smartphone /></button></div>
          <div class="zoom-control"><button type="button" aria-label="Alejar" @click="zoomBy(-10)"><Minus /></button><select v-model.number="previewZoom" aria-label="Zoom de vista previa"><option :value="50">50%</option><option :value="75">75%</option><option :value="90">90%</option><option :value="100">100%</option><option :value="125">125%</option></select><button type="button" aria-label="Acercar" @click="zoomBy(10)"><Plus /></button></div>
        </div>
      </div>

      <div ref="editorBody" class="editor-body">
        <SitesEditorForms ref="formsPanel" :site-id="siteId" :page-id="pageId" :page-title="form.title" :page-path="form.path" :page-status="page.status" :page-version="page.draft?.version || 1" :page-updated-at="page.draft?.updatedAt" :dirty="dirty" :active-file="activeFile" :sidebar-width="sidebarWidth" @rescan="rescanForms" @connection-change="connectionOpen = $event" @file-select="selectFile" @form-select="focusPreviewForm" @field-select="focusPreviewField" />
        <PanelResizeHandle v-if="!connectionOpen" v-model="sidebarWidth" :min="215" :max="340" :default-value="250" :measure="measureSidebar" label="Redimensionar panel lateral" @commit="persistWidths" />

        <main class="workspace" :class="[`mode-${workspace}`]">
          <section v-if="workspace !== 'preview' && !connectionOpen" class="code-pane" :style="workspace === 'split' ? { width: `${codePercent}%` } : undefined">
            <div class="code-tabs"><button type="button" :class="{ active: activeFile === 'html' }" @click="activeFile = 'html'">index.html</button><button type="button" :class="{ active: activeFile === 'css' }" @click="activeFile = 'css'">styles.css</button><button type="button" :class="{ active: activeFile === 'js' }" @click="activeFile = 'js'">site.js</button></div>
            <div class="code-editor-host"><ClientOnly><SitesCodeEditor ref="codeEditor" v-model="activeCode" :language="activeFile" :ariaLabel="`Código ${activeFile.toUpperCase()} de la página`" /><template #fallback><div class="editor-loading">Preparando editor…</div></template></ClientOnly></div>
            <footer class="editor-status"><span>{{ activeFile.toUpperCase() }}</span><span>Espacios: 2</span><span>UTF-8</span><span>Ctrl + S para guardar</span></footer>
          </section>

          <PanelResizeHandle v-if="workspace === 'split' && !connectionOpen" v-model="codePercent" :min="28" :max="72" :default-value="50" :step="2" :measure="measureWorkspace" bordered label="Redimensionar código y vista previa" @commit="persistWidths" />

          <section v-if="workspace !== 'code' || connectionOpen" class="preview-pane">
            <div class="preview-bar"><span><Laptop />Vista previa</span><div><small>{{ viewport === 'desktop' ? 'Escritorio' : viewport === 'tablet' ? 'Tablet' : 'Móvil' }}</small><button type="button" title="Ajustar vista" @click="previewZoom = 100"><Maximize2 /></button></div></div>
            <div class="preview-stage theme-light"><iframe class="theme-light" ref="previewFrame" :style="previewTransform" sandbox="allow-scripts allow-forms allow-modals" :srcdoc="previewDocument" title="Vista previa aislada de la página" @load="sendPreviewSelection" /></div>
          </section>
        </main>
      </div>
    </template>
  </div>
</template>

<style scoped>
.site-ide{display:flex;width:100%;height:100%;min-height:0;flex-direction:column;overflow:hidden;background:rgb(var(--brand-bg));color:rgb(var(--brand-text))}.editor-header{display:flex;height:55px;min-height:55px;align-items:center;justify-content:space-between;gap:18px;border-bottom:1px solid rgb(var(--brand-sites-editor-divider));background:rgb(var(--brand-surface));padding:7px 14px}.page-identity{display:flex;min-width:0;align-items:center;gap:10px}.back-button{display:grid;width:32px;height:32px;flex:0 0 auto;place-items:center;border:1px solid rgb(var(--brand-control-border));border-radius:5px;color:rgb(var(--brand-text-secondary))}.back-button:hover{background:rgb(var(--brand-bg));color:rgb(var(--brand-blue))}.back-button svg{width:15px}.page-fields{min-width:0}.title-line,.path-line{display:flex;align-items:center;gap:7px}.title-line input{min-width:80px;max-width:280px;border:0;background:transparent;color:rgb(var(--brand-text));font-size:13px;font-weight:800;outline:0}.path-line{margin-top:1px;color:rgb(var(--brand-sites-muted));font-size:9px}.path-line input{width:120px;border:0;background:transparent;color:rgb(var(--brand-sites-muted));outline:0}.path-line b{font-weight:600}.status-chip{border-radius:999px;background:rgb(var(--brand-sites-editor-draft-bg));padding:2px 7px;color:rgb(var(--brand-sites-editor-draft-text));font-size:9px;font-weight:800}.status-chip.published{background:rgb(var(--brand-success-bg));color:rgb(var(--brand-success-text))}.header-actions{display:flex;align-items:center;gap:7px}.save-state{display:flex;align-items:center;gap:5px;margin-right:3px;font-size:9px;font-weight:700}.save-state i{width:6px;height:6px;border-radius:50%;background:rgb(var(--brand-sites-editor-dirty-dot))}.save-state.dirty{color:rgb(var(--brand-sites-editor-dirty-text))}.save-state.saved{color:rgb(var(--brand-success-text))}.save-state svg{width:12px}.ghost-button,.publish-button{display:flex;height:32px;align-items:center;gap:6px;border-radius:4px;padding:0 11px;font-size:10px;font-weight:700}.ghost-button{border:1px solid rgb(var(--brand-control-border));background:rgb(var(--brand-surface));color:rgb(var(--brand-text))}.ghost-button:hover{border-color:rgb(var(--brand-sites-editor-hover-border));color:rgb(var(--brand-sites-editor-link))}.ghost-button:disabled{opacity:.45}.publish-button{background:rgb(var(--brand-orange));color:rgb(var(--brand-primary-fg))}.publish-button:hover{background:rgb(var(--brand-orange-hover))}.ghost-button svg,.publish-button svg{width:13px}.more-button{display:grid;width:30px;height:30px;place-items:center;color:rgb(var(--brand-sites-editor-icon))}.more-button svg{width:16px}.editor-toolbar{display:flex;height:44px;min-height:44px;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid rgb(var(--brand-sites-editor-divider));background:rgb(var(--brand-surface));padding:5px 12px}.segmented{display:flex;height:32px;align-items:center;border:1px solid rgb(var(--brand-control-border));border-radius:5px;background:rgb(var(--brand-surface));padding:2px}.segmented button{display:flex;height:26px;align-items:center;justify-content:center;gap:5px;border-radius:3px;padding:0 9px;color:rgb(var(--brand-sites-editor-tab));font-size:10px;font-weight:700}.segmented button.active{background:rgb(var(--brand-blue-bg));color:rgb(var(--brand-blue-hover))}.segmented svg{width:13px}.toolbar-center{display:flex;align-items:center;gap:12px;color:rgb(var(--brand-sites-muted));font-size:9px}.toolbar-center span{display:flex;align-items:center;gap:5px}.toolbar-center svg{width:12px}.toolbar-center button{display:flex;height:28px;align-items:center;gap:5px;border:1px solid rgb(var(--brand-control-border));border-radius:4px;padding:0 8px;color:rgb(var(--brand-text-secondary));font-size:9px;font-weight:700}.toolbar-right{display:flex;align-items:center;gap:7px}.icon-segment button{width:28px;padding:0}.zoom-control{display:flex;height:32px;align-items:center;overflow:hidden;border:1px solid rgb(var(--brand-control-border));border-radius:5px;background:rgb(var(--brand-surface))}.zoom-control button{display:grid;width:28px;height:100%;place-items:center;color:rgb(var(--brand-sites-editor-icon))}.zoom-control button:hover{background:rgb(var(--brand-label-stage));color:rgb(var(--brand-sites-editor-link))}.zoom-control svg{width:12px}.zoom-control select{height:100%;border:0;border-right:1px solid rgb(var(--brand-border-light));border-left:1px solid rgb(var(--brand-border-light));background:rgb(var(--brand-surface));padding:0 5px;color:rgb(var(--brand-text));font-size:9px;font-weight:700;outline:0}.editor-body{position:relative;display:flex;min-height:0;flex:1;overflow:hidden}.workspace{display:flex;min-width:0;min-height:0;flex:1;background:rgb(var(--brand-surface))}.code-pane,.preview-pane{display:flex;min-width:0;min-height:0;flex-direction:column;overflow:hidden;background:rgb(var(--brand-surface))}.code-editor-host{position:relative;display:block;min-width:0;min-height:0;flex:1 1 0;height:0;overflow:hidden}.code-pane{flex:0 0 auto}.mode-code .code-pane{width:100%;flex:1}.preview-pane{flex:1}.mode-preview .preview-pane{width:100%}.code-tabs{display:flex;height:38px;min-height:38px;align-items:stretch;border-bottom:1px solid rgb(var(--brand-sites-editor-divider));background:rgb(var(--brand-designer-section-bg));padding-left:8px}.code-tabs button{border-bottom:2px solid transparent;padding:0 12px;color:rgb(var(--brand-sites-editor-icon));font-family:monospace;font-size:10px}.code-tabs button.active{border-bottom-color:rgb(var(--brand-orange));background:rgb(var(--brand-surface));color:rgb(var(--brand-text))}.editor-loading{display:grid;flex:1;place-items:center;color:rgb(var(--brand-sites-muted));font-size:11px}.editor-status{display:flex;height:23px;min-height:23px;align-items:center;justify-content:flex-end;gap:14px;border-top:1px solid rgb(var(--brand-border-light));background:rgb(var(--brand-designer-section-bg));padding:0 9px;color:rgb(var(--brand-sites-muted));font-size:8px}.preview-bar{display:flex;height:38px;min-height:38px;align-items:center;justify-content:space-between;border-bottom:1px solid rgb(var(--brand-sites-editor-divider));background:rgb(var(--brand-designer-section-bg));padding:0 10px}.preview-bar>span{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:800}.preview-bar svg{width:13px;color:rgb(var(--brand-blue))}.preview-bar>div{display:flex;align-items:center;gap:8px}.preview-bar small{color:rgb(var(--brand-sites-muted));font-size:9px}.preview-bar button{display:grid;width:25px;height:25px;place-items:center;border-radius:3px;color:rgb(var(--brand-sites-editor-icon))}.preview-bar button:hover{background:rgb(var(--brand-blue-bg));color:rgb(var(--brand-sites-editor-link))}.preview-stage{display:flex;min-height:0;flex:1;justify-content:center;overflow:auto;background:rgb(var(--brand-sites-editor-preview));padding:14px}.preview-stage iframe{height:calc(100% / var(--preview-scale, 1));min-height:600px;max-width:none;border:1px solid rgb(var(--brand-control-border));background:rgb(var(--brand-surface));box-shadow:0 2px 7px rgb(var(--brand-shadow) / 0.08627450980392157)}.load-error{margin:24px;border:1px solid rgb(var(--brand-sites-editor-error-border));border-radius:5px;background:rgb(var(--brand-error-bg));padding:15px;color:rgb(var(--brand-error-text));font-size:12px}@media(max-width:1120px){.save-state,.preview-action{display:none}.toolbar-center>span{display:none}}@media(max-width:900px){.editor-body>:deep(.panel-resize-handle){display:none}.forms-composite{width:220px!important}.toolbar-center{display:none}}@media(max-width:720px){.site-ide{overflow:auto}.editor-header{position:sticky;top:0;z-index:30}.header-actions .ghost-button{display:none}.editor-toolbar{position:sticky;top:55px;z-index:29}.toolbar-right{display:none}.editor-body{min-height:720px;overflow:visible;flex-direction:column}.editor-body>:deep(.panel-resize-handle){display:none}.workspace{width:100%;min-height:620px}.forms-composite{width:100%!important;max-height:240px}.mode-split .preview-pane{display:none}.mode-split .code-pane{width:100%!important;flex:1}}
.site-ide :is(button,a,input,select):focus-visible{outline:2px solid rgb(var(--brand-blue));outline-offset:2px}
.site-ide :is(input,select,option){color-scheme:inherit}
</style>
