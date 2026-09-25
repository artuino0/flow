<script setup lang="ts">
import { ArrowLeft, Check, Code2, Eye, FileCode2, Laptop, Maximize2, Minus, Monitor, MoreVertical, PanelRight, Plus, Rocket, Save, Smartphone, Tablet, WandSparkles } from '@lucide/vue'
import { buildPreviewDocument, joinSiteScript, splitSiteScript } from '~/utils/sitesEditorScript'

definePageMeta({ layout: 'default', editorFullscreen: true, fullBleed: true })
interface Draft { id: string; version: number; html: string; css: string; updatedAt: string }
interface PageDetail { id: string; title: string; path: string; kind: 'website' | 'landing'; status: string; draft: Draft | null; versions: Array<{ id: string; version: number; status: string; updatedAt: string }> }

const route = useRoute()
const siteId = route.params.siteId as string
const pageId = route.params.pageId as string
const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
const { data: page, error, refresh } = await useFetch<PageDetail>(() => `/api/sites/${siteId}/pages/${pageId}`, { headers })
const form = reactive({ title: '', path: '', html: '', css: '', js: '' })
const activeFile = ref<'html' | 'css' | 'js'>('html')
const workspace = ref<'code' | 'split' | 'preview'>('split')
const viewport = ref<'desktop' | 'tablet' | 'mobile'>('desktop')
const previewZoom = ref(100)
const sidebarWidth = ref(250)
const codePercent = ref(50)
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
let stopResize: (() => void) | null = null

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
const previewDocument = computed(() => buildPreviewDocument(serializedHtml(), form.css))
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
function beginResize(kind: 'sidebar' | 'workspace', event: PointerEvent) {
  const bounds = editorBody.value?.getBoundingClientRect()
  if (!bounds) return
  event.preventDefault()
  document.body.classList.add('sites-resizing')
  const move = (moveEvent: PointerEvent) => {
    if (kind === 'sidebar') sidebarWidth.value = Math.min(340, Math.max(215, moveEvent.clientX - bounds.left))
    else {
      const workspaceLeft = bounds.left + sidebarWidth.value + 5
      const available = Math.max(1, bounds.right - workspaceLeft)
      codePercent.value = Math.min(72, Math.max(28, ((moveEvent.clientX - workspaceLeft) / available) * 100))
    }
  }
  const up = () => {
    document.body.classList.remove('sites-resizing')
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    localStorage.setItem('flow-sites-sidebar-width', String(sidebarWidth.value))
    localStorage.setItem('flow-sites-code-percent', String(codePercent.value))
    stopResize = null
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  stopResize = up
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
function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
}
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value) event.preventDefault() }
onMounted(() => {
  const storedSidebar = Number(localStorage.getItem('flow-sites-sidebar-width'))
  const storedCode = Number(localStorage.getItem('flow-sites-code-percent'))
  if (storedSidebar) sidebarWidth.value = Math.min(340, Math.max(215, storedSidebar))
  if (storedCode) codePercent.value = Math.min(72, Math.max(28, storedCode))
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', beforeUnload)
})
onBeforeUnmount(() => {
  stopResize?.()
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
        <button v-if="!connectionOpen" type="button" class="resize-handle" aria-label="Redimensionar panel lateral" @pointerdown="beginResize('sidebar', $event)"><span /></button>

        <main class="workspace" :class="[`mode-${workspace}`]">
          <section v-if="workspace !== 'preview' && !connectionOpen" class="code-pane" :style="workspace === 'split' ? { width: `${codePercent}%` } : undefined">
            <div class="code-tabs"><button type="button" :class="{ active: activeFile === 'html' }" @click="activeFile = 'html'">index.html</button><button type="button" :class="{ active: activeFile === 'css' }" @click="activeFile = 'css'">styles.css</button><button type="button" :class="{ active: activeFile === 'js' }" @click="activeFile = 'js'">site.js</button></div>
            <div class="code-editor-host"><ClientOnly><SitesCodeEditor v-model="activeCode" :language="activeFile" :ariaLabel="`Código ${activeFile.toUpperCase()} de la página`" /><template #fallback><div class="editor-loading">Preparando editor…</div></template></ClientOnly></div>
            <footer class="editor-status"><span>{{ activeFile.toUpperCase() }}</span><span>Espacios: 2</span><span>UTF-8</span><span>Ctrl + S para guardar</span></footer>
          </section>

          <button v-if="workspace === 'split' && !connectionOpen" type="button" class="resize-handle inner" aria-label="Redimensionar código y vista previa" @pointerdown="beginResize('workspace', $event)"><span /></button>

          <section v-if="workspace !== 'code' || connectionOpen" class="preview-pane">
            <div class="preview-bar"><span><Laptop />Vista previa</span><div><small>{{ viewport === 'desktop' ? 'Escritorio' : viewport === 'tablet' ? 'Tablet' : 'Móvil' }}</small><button type="button" title="Ajustar vista" @click="previewZoom = 100"><Maximize2 /></button></div></div>
            <div class="preview-stage"><iframe ref="previewFrame" :style="previewTransform" sandbox="allow-scripts allow-forms allow-modals" :srcdoc="previewDocument" title="Vista previa aislada de la página" @load="sendPreviewSelection" /></div>
          </section>
        </main>
      </div>
    </template>
  </div>
</template>

<style scoped>
.site-ide{display:flex;width:100%;height:100%;min-height:0;flex-direction:column;overflow:hidden;background:#f5f8fa;color:#33475b}.editor-header{display:flex;height:55px;min-height:55px;align-items:center;justify-content:space-between;gap:18px;border-bottom:1px solid #dfe6ed;background:#fff;padding:7px 14px}.page-identity{display:flex;min-width:0;align-items:center;gap:10px}.back-button{display:grid;width:32px;height:32px;flex:0 0 auto;place-items:center;border:1px solid #cbd6e2;border-radius:5px;color:#516f90}.back-button:hover{background:#f5f8fa;color:#0091ae}.back-button svg{width:15px}.page-fields{min-width:0}.title-line,.path-line{display:flex;align-items:center;gap:7px}.title-line input{min-width:80px;max-width:280px;border:0;background:transparent;color:#33475b;font-size:13px;font-weight:800;outline:0}.path-line{margin-top:1px;color:#8da1b5;font-size:9px}.path-line input{width:120px;border:0;background:transparent;color:#8da1b5;outline:0}.path-line b{font-weight:600}.status-chip{border-radius:999px;background:#fff2ee;padding:2px 7px;color:#d95d3f;font-size:9px;font-weight:800}.status-chip.published{background:#ccf1de;color:#0a7a4f}.header-actions{display:flex;align-items:center;gap:7px}.save-state{display:flex;align-items:center;gap:5px;margin-right:3px;font-size:9px;font-weight:700}.save-state i{width:6px;height:6px;border-radius:50%;background:#d59117}.save-state.dirty{color:#a66c08}.save-state.saved{color:#0a7a4f}.save-state svg{width:12px}.ghost-button,.publish-button{display:flex;height:32px;align-items:center;gap:6px;border-radius:4px;padding:0 11px;font-size:10px;font-weight:700}.ghost-button{border:1px solid #cbd6e2;background:#fff;color:#33475b}.ghost-button:hover{border-color:#8cc9d4;color:#0088a3}.ghost-button:disabled{opacity:.45}.publish-button{background:#ff7a59;color:#fff}.publish-button:hover{background:#e66e50}.ghost-button svg,.publish-button svg{width:13px}.more-button{display:grid;width:30px;height:30px;place-items:center;color:#7890a6}.more-button svg{width:16px}.editor-toolbar{display:flex;height:44px;min-height:44px;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid #dfe6ed;background:#fff;padding:5px 12px}.segmented{display:flex;height:32px;align-items:center;border:1px solid #cbd6e2;border-radius:5px;background:#fff;padding:2px}.segmented button{display:flex;height:26px;align-items:center;justify-content:center;gap:5px;border-radius:3px;padding:0 9px;color:#6f8499;font-size:10px;font-weight:700}.segmented button.active{background:#eaf3f6;color:#007f98}.segmented svg{width:13px}.toolbar-center{display:flex;align-items:center;gap:12px;color:#8da1b5;font-size:9px}.toolbar-center span{display:flex;align-items:center;gap:5px}.toolbar-center svg{width:12px}.toolbar-center button{display:flex;height:28px;align-items:center;gap:5px;border:1px solid #cbd6e2;border-radius:4px;padding:0 8px;color:#516f90;font-size:9px;font-weight:700}.toolbar-right{display:flex;align-items:center;gap:7px}.icon-segment button{width:28px;padding:0}.zoom-control{display:flex;height:32px;align-items:center;overflow:hidden;border:1px solid #cbd6e2;border-radius:5px;background:#fff}.zoom-control button{display:grid;width:28px;height:100%;place-items:center;color:#7890a6}.zoom-control button:hover{background:#f1f6f8;color:#0088a3}.zoom-control svg{width:12px}.zoom-control select{height:100%;border:0;border-right:1px solid #e5eaf0;border-left:1px solid #e5eaf0;background:#fff;padding:0 5px;color:#33475b;font-size:9px;font-weight:700;outline:0}.editor-body{position:relative;display:flex;min-height:0;flex:1;overflow:hidden}.resize-handle{position:relative;z-index:15;width:5px;min-width:5px;height:100%;cursor:col-resize;background:#eef2f5}.resize-handle:hover,.resize-handle:active{background:#d6edf1}.resize-handle span{position:absolute;top:50%;left:1px;width:3px;height:38px;transform:translateY(-50%);border-radius:2px;background:#adc0cf;opacity:0}.resize-handle:hover span,.resize-handle:active span{opacity:1}.resize-handle.inner{border-right:1px solid #d8e1e8;border-left:1px solid #d8e1e8}.workspace{display:flex;min-width:0;min-height:0;flex:1;background:#fff}.code-pane,.preview-pane{display:flex;min-width:0;min-height:0;flex-direction:column;overflow:hidden;background:#fff}.code-editor-host{position:relative;display:block;min-width:0;min-height:0;flex:1 1 0;height:0;overflow:hidden}.code-pane{flex:0 0 auto}.mode-code .code-pane{width:100%;flex:1}.preview-pane{flex:1}.mode-preview .preview-pane{width:100%}.code-tabs{display:flex;height:38px;min-height:38px;align-items:stretch;border-bottom:1px solid #dfe6ed;background:#f8fafb;padding-left:8px}.code-tabs button{border-bottom:2px solid transparent;padding:0 12px;color:#7890a6;font-family:monospace;font-size:10px}.code-tabs button.active{border-bottom-color:#ff7a59;background:#fff;color:#33475b}.editor-loading{display:grid;flex:1;place-items:center;color:#8da1b5;font-size:11px}.editor-status{display:flex;height:23px;min-height:23px;align-items:center;justify-content:flex-end;gap:14px;border-top:1px solid #e5eaf0;background:#f8fafb;padding:0 9px;color:#8da1b5;font-size:8px}.preview-bar{display:flex;height:38px;min-height:38px;align-items:center;justify-content:space-between;border-bottom:1px solid #dfe6ed;background:#f8fafb;padding:0 10px}.preview-bar>span{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:800}.preview-bar svg{width:13px;color:#0091ae}.preview-bar>div{display:flex;align-items:center;gap:8px}.preview-bar small{color:#8da1b5;font-size:9px}.preview-bar button{display:grid;width:25px;height:25px;place-items:center;border-radius:3px;color:#7890a6}.preview-bar button:hover{background:#eaf3f6;color:#0088a3}.preview-stage{display:flex;min-height:0;flex:1;justify-content:center;overflow:auto;background:#e9eef2;padding:14px}.preview-stage iframe{height:calc(100% / var(--preview-scale, 1));min-height:600px;max-width:none;border:1px solid #cbd6e2;background:#fff;box-shadow:0 2px 7px #33475b16}.load-error{margin:24px;border:1px solid #f2b8ae;border-radius:5px;background:#fbe0dd;padding:15px;color:#c7391f;font-size:12px}:global(body.sites-resizing){cursor:col-resize!important;user-select:none!important}:global(body.sites-resizing *){cursor:col-resize!important}@media(max-width:1120px){.save-state,.preview-action{display:none}.toolbar-center>span{display:none}}@media(max-width:900px){.editor-body>.resize-handle:first-of-type{display:none}.forms-composite{width:220px!important}.toolbar-center{display:none}}@media(max-width:720px){.site-ide{overflow:auto}.editor-header{position:sticky;top:0;z-index:30}.header-actions .ghost-button{display:none}.editor-toolbar{position:sticky;top:55px;z-index:29}.toolbar-right{display:none}.editor-body{min-height:720px;overflow:visible;flex-direction:column}.editor-body>.resize-handle{display:none}.workspace{width:100%;min-height:620px}.forms-composite{width:100%!important;max-height:240px}.mode-split .preview-pane{display:none}.mode-split .code-pane{width:100%!important;flex:1}}
</style>
