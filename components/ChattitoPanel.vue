<script setup lang="ts">
import { lookAtElement, isAnimatedChattitoMessage, type ChattitoLookAt } from '~/utils/chattito'
import { CHATTITO_MAX_WIDTH, CHATTITO_MIN_WIDTH } from '~/composables/useChattitoPanel'
import { agentFallbackReply, agentHistory, courtesyReply, type AgentAction, type AgentReply } from '~/utils/agentConversation'
import { runAgentAction, agentModuleRouteExists } from '~/utils/agentActions'
import { waitForTourTarget } from '~/utils/onboardingTours'
import { isNavigationFailure, NavigationFailureType } from 'vue-router'
import { helpForContext } from '~/utils/chattitoHelp'

const { panel, close, addMessage, setAvatarState, disposeAvatarStateTimer, setWidth, restoreWidth, saveWidth } = useChattitoPanel()
const { activeId, pendingTour, startTour, resumeTour, omitTour, canLaunchTour, agentActionPending, agentPreparingTour, prepareTour, firstTourSelector } = useOnboarding()
const { ready: helpPreferencesReady, disabled: helpDisabled, setDisabled: setHelpDisabled } = useChattitoHelpPreferences()
const route = useRoute()
const { context, recommendedTour } = useChattitoContext()
const currentTourTitle = computed(() => helpForContext(context.value)?.title ?? null)
const router = useRouter()
const { headers: agentHeaders } = useAgentSession()
const { user: agentUser } = useAuth()
const sessionIdentity = () => `${agentUser.value?.tenantId}:${agentUser.value?.id}:${agentUser.value?.sessionId}`
const lookAt = ref<ChattitoLookAt>('center')
const draft = ref('')
const list = ref<HTMLElement>()
const pending = ref(false)
let highlight: import('driver.js').Driver | undefined
let resizeStartX = 0
let resizeStartWidth = CHATTITO_MIN_WIDTH

const lastChattitoIndex = computed(() => panel.value.messages.reduce((last, message, index) => message.role === 'assistant' ? index : last, -1))
const lastResumeMessageId = computed(() => [...panel.value.messages].reverse().find(message => message.action?.kind === 'resume-tour')?.id)
const visibleMessages = computed(() => panel.value.messages.slice(-30))
const visibleOffset = computed(() => panel.value.messages.length - visibleMessages.value.length)

watch(() => [panel.value.open, panel.value.messages.length], async () => {
  await nextTick()
  if (list.value) list.value.scrollTop = list.value.scrollHeight
})

async function send() {
 const text = draft.value.trim()
 if (!text || text.length > 600 || pending.value) return
 const owner = sessionIdentity()
 const history = agentHistory(panel.value.messages)
 addMessage({ role: 'user', text })
 const placeholder = addMessage({ role: 'assistant', text: '', emotion: 'typing' })
 setAvatarState('typing'); pending.value = true; draft.value = ''
 try {
  const reply = courtesyReply(text, history) || await $fetch<AgentReply>('/api/agent/messages', { method: 'POST', headers: await agentHeaders(), body: { message: text, context: { ...context.value, path: route.path }, history } })
  if (owner !== sessionIdentity()) return
  Object.assign(placeholder, { text: reply.reply, emotion: reply.emotion, actions: reply.actions })
  // addMessage devuelve la referencia original, Vue puede envolverla: actualizar por id.
  const index = panel.value.messages.findIndex(message => message.id === placeholder.id)
  if (index >= 0) panel.value.messages[index] = { ...placeholder }
  setAvatarState(reply.emotion)
 } catch {
  if (owner !== sessionIdentity()) return
  const index = panel.value.messages.findIndex(message => message.id === placeholder.id)
  if (index >= 0) panel.value.messages[index] = { ...placeholder, text: agentFallbackReply('network', { message: text, history }).reply, emotion: 'idle' }
  setAvatarState('idle')
 } finally { pending.value = false; await nextTick(); document.getElementById('chattito-message')?.focus() }
}
function actionLabel(action: AgentAction) { return action.kind === 'navigate' ? action.label?.slice(0, 65) || 'Llévame' : action.kind === 'point' ? 'Señálame' : 'Ver recorrido' }
async function runAction(action: AgentAction) {
 if (agentActionPending.value) return
 const owner = sessionIdentity()
 let actionCurrent = true
 agentActionPending.value = true
 try {
  const succeeded = await runAgentAction(action, {
   route: () => route,
   routerPath: () => router.currentRoute.value.fullPath,
   routeExists: path => agentModuleRouteExists(path, destination => router.resolve(destination)),
   prepareModule: async (slug, create) => {
    const metadata = await $fetch<{ entity: { isActive: boolean; deletedAt?: string | null }; permissions: { canRead: boolean; canCreate: boolean } }>(`/api/entities/${slug}/fields`, { timeout: 8_000 })
    return metadata.entity.isActive && !metadata.entity.deletedAt && metadata.permissions.canRead && (!create || metadata.permissions.canCreate)
   },
   push: async path => {
    const failure = await router.push(path)
    return !isNavigationFailure(failure) || isNavigationFailure(failure, NavigationFailureType.duplicated)
   },
   nextTick: async () => { await nextTick() },
   isCurrent: () => actionCurrent && owner === sessionIdentity(),
   prepareTour: async id => {
    const permitted = await prepareTour(id)
    if (permitted && actionCurrent && owner === sessionIdentity()) agentPreparingTour.value = id
    return permitted
   },
   firstSelector: firstTourSelector,
   waitTarget: (selector, ready, abort, timeoutMs) => waitForTourTarget(
    () => ready() ? selector ? document.querySelector(selector) : document.body : null,
    element => !selector || (element.getClientRects().length > 0 && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden'),
    { timeoutMs, intervalMs: 50, abort }
   ),
   startTour,
   beforeTour: () => { highlight?.destroy(); close() },
   message: text => { addMessage({ role: 'assistant', text, emotion: 'idle' }); setAvatarState('idle') },
   point: async (element, title, description) => {
    lookAt.value = lookAtElement(element)
    const { driver } = await import('driver.js')
    highlight?.destroy()
    highlight = driver({ animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches, onDestroyed: () => { lookAt.value = 'center'; document.getElementById('chattito-message')?.focus() } })
    highlight.highlight({ element, popover: { title, description } })
   }
  })
  if (!succeeded && action.kind === 'start-tour' && owner === sessionIdentity()) panel.value.open = true
  if (succeeded && action.kind === 'navigate') document.querySelector<HTMLElement>('main h1')?.focus()
 } finally { actionCurrent = false; agentPreparingTour.value = null; agentActionPending.value = false }
}

function startResize(event: PointerEvent) {
  if (event.button !== 0 || window.matchMedia('(max-width: 1023px)').matches) return
  event.preventDefault()
  resizeStartX = event.clientX
  resizeStartWidth = panel.value.width
  panel.value.resizing = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function moveResize(event: PointerEvent) {
  if (panel.value.resizing) setWidth(resizeStartWidth + resizeStartX - event.clientX)
}
function finishResize(event: PointerEvent) {
  if (!panel.value.resizing) return
  panel.value.resizing = false
  const handle = event.currentTarget as HTMLElement
  if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
  saveWidth()
}
function resizeWithKeyboard(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
  event.preventDefault()
  if (event.key === 'Home') setWidth(CHATTITO_MIN_WIDTH)
  else if (event.key === 'End') setWidth(CHATTITO_MAX_WIDTH)
  else setWidth(panel.value.width + (event.key === 'ArrowLeft' ? 20 : -20))
  saveWidth()
}

onMounted(restoreWidth)
onBeforeUnmount(() => {
  highlight?.destroy()
  disposeAvatarStateTimer()
  panel.value.resizing = false
})
</script>

<template>
  <Transition name="chattito-panel">
    <aside v-if="panel.open" class="chattito-panel" aria-label="Conversación con Chattito">
      <div class="chattito-panel__resize" role="separator" aria-label="Ajustar ancho de Chattito" aria-orientation="vertical" :aria-valuemin="CHATTITO_MIN_WIDTH" :aria-valuemax="CHATTITO_MAX_WIDTH" :aria-valuenow="panel.width" tabindex="0" @pointerdown="startResize" @pointermove="moveResize" @pointerup="finishResize" @pointercancel="finishResize" @keydown="resizeWithKeyboard" />
      <header class="chattito-panel__header">
        <div class="chattito-panel__identity"><svg class="chattito-panel__avatar" viewBox="0 0 200 200" aria-hidden="true"><use href="#chattito-symbol" /></svg><div><strong>Chattito</strong><span>Tu asistente de Flow</span></div></div>
        <button type="button" aria-label="Cerrar Chattito" class="chattito-panel__close" @click="close">×</button>
      </header>
      <div ref="list" class="chattito-panel__messages" aria-live="polite">
        <TransitionGroup name="chattito-message">
          <article v-for="(message, index) in visibleMessages" :key="message.id" class="chattito-message" :class="`chattito-message--${message.role}`">
            <ChattitoMessageAvatar v-if="message.role === 'assistant'" :animated="isAnimatedChattitoMessage(index + visibleOffset, lastChattitoIndex)" :look-at="lookAt" :state="message.emotion === 'typing' ? 'typing' : panel.avatarState" size="md" />
            <span v-if="message.emotion === 'typing'" class="sr-only">Chattito está escribiendo</span>
            <p v-else>{{ message.text }}<button v-if="message.action?.kind === 'resume-tour' && message.id === lastResumeMessageId && !activeId && pendingTour?.id === message.action.tourId" type="button" class="chattito-message__resume" @click="resumeTour(message.action.tourId)">Retomar recorrido</button><button v-if="message.role === 'assistant' && message.action?.kind === 'start-tour' && !activeId && route.fullPath === message.action.originPath && recommendedTour === message.action.tourId && canLaunchTour(message.action.tourId)" type="button" class="chattito-message__resume" @click="startTour(message.action.tourId)">Ver recorrido</button><button v-for="(action, actionIndex) in message.actions" :key="actionIndex" type="button" class="chattito-message__resume" @click="runAction(action)">{{ actionLabel(action) }}</button></p>
          </article>
        </TransitionGroup>
      </div>
      <section class="chattito-panel__tours" aria-label="Recorridos">
        <label v-if="helpPreferencesReady" class="chattito-panel__help-preference"><input type="checkbox" :checked="helpDisabled" @change="setHelpDisabled(($event.target as HTMLInputElement).checked)"> No me sugieras más ayuda</label>
        <strong>Recorridos</strong>
        <div>
          <button type="button" @click="startTour('bienvenida')">Repetir bienvenida</button>
          <button v-if="canLaunchTour('primer-modulo')" type="button" @click="startTour('primer-modulo')">Cómo crear mi primer módulo</button>
          <button v-if="canLaunchTour('crear-modulo-manual')" type="button" @click="startTour('crear-modulo-manual')">Crear un módulo manualmente</button>
          <button v-if="recommendedTour && canLaunchTour(recommendedTour)" type="button" @click="startTour(recommendedTour)">Recorrer {{ currentTourTitle }}</button>
          <button v-if="!activeId && pendingTour" type="button" @click="resumeTour()">Continuar recorrido</button>
          <button v-if="!activeId && pendingTour" type="button" @click="omitTour">Omitir</button>
        </div>
        <p v-if="!canLaunchTour('primer-modulo')" class="chattito-panel__tour-help">Este recorrido no está disponible para tu cuenta.</p>
      </section>
      <form class="chattito-panel__composer" @submit.prevent="send">
        <label class="sr-only" for="chattito-message">Escribe a Chattito</label>
        <input id="chattito-message" v-model="draft" autocomplete="off" maxlength="600" placeholder="Escribe un mensaje…" :disabled="pending">
        <button type="submit" :disabled="!draft.trim() || pending" aria-label="Enviar mensaje">↑</button>
      </form>
      <p class="chattito-panel__footnote">Te guío en Flow · No consulto tus registros</p>
    </aside>
  </Transition>
</template>

<style>
.chattito-panel{position:relative;display:flex;width:var(--chattito-panel-width,400px);height:100%;flex-direction:column;border-left:1px solid #d9e2eb;background:#fdfefe;color:#213343}.chattito-panel__resize{position:absolute;z-index:1;top:0;bottom:0;left:0;width:12px;cursor:col-resize;touch-action:none}.chattito-panel__resize::after{position:absolute;top:50%;left:4px;width:3px;height:36px;border-radius:3px;background:#cbd6e2;content:"";transform:translateY(-50%)}.chattito-panel__resize:hover::after,.chattito-panel__resize:focus-visible::after{background:#0091ae}.chattito-panel__resize:focus-visible{outline:2px solid #0091ae;outline-offset:-2px}.chattito-panel__header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5eaf0;padding:16px 18px}.chattito-panel__identity{display:flex;align-items:center;gap:12px}.chattito-panel__avatar{width:56px;height:56px;flex:none}.chattito-panel__identity div{display:grid;gap:3px}.chattito-panel__identity strong{font-size:14px}.chattito-panel__identity span,.chattito-panel__footnote{font-size:11px;color:#718096}.chattito-panel__close{width:32px;height:32px;border-radius:7px;color:#516f90;font-size:24px;line-height:1}.chattito-panel__close:hover{background:#edf3f6}.chattito-panel__messages{display:flex;min-height:0;flex:1;flex-direction:column;gap:12px;overflow:auto;padding:14px 16px;scrollbar-width:thin;scrollbar-color:#cbd6e2 transparent}.chattito-message{display:flex;align-items:center;gap:4px;content-visibility:auto;contain-intrinsic-size:auto 104px}.chattito-message p{max-width:82%;margin:0;border:1px solid #e5eaf0;border-radius:14px 14px 14px 4px;background:#f5f8fa;padding:10px 12px;font-size:13px;line-height:1.5}.chattito-message--user{justify-content:flex-end;min-height:42px}.chattito-message--user p{border-color:#cdebf0;border-radius:14px 14px 4px 14px;background:#e5f5f8;color:#214e59}.chattito-panel__composer{display:flex;gap:8px;border:1px solid #d9e2eb;border-radius:12px;margin:14px 14px 0;padding:6px;background:white}.chattito-panel__composer input{min-width:0;flex:1;border:0;background:transparent;padding:7px;font-size:13px;outline:none}.chattito-panel__composer button{width:34px;height:34px;border-radius:9px;background:#0091ae;color:white;font-size:20px}.chattito-panel__composer button:disabled{opacity:.45}.chattito-panel__footnote{margin:8px 16px 13px;text-align:center}.chattito-panel-enter-active,.chattito-panel-leave-active{transition:opacity .22s ease}.chattito-panel-enter-from,.chattito-panel-leave-to{opacity:0}.chattito-message-move{transition:transform .28s ease}.chattito-message-enter-active,.chattito-message-leave-active{transition:opacity .2s ease,transform .2s ease}.chattito-message-enter-from,.chattito-message-leave-to{opacity:0;transform:translateY(8px)}
.chattito-panel__avatar{width:42px;height:42px}.chattito-message{contain-intrinsic-size:auto 78px}
.chattito-panel__tours{border-top:1px solid #e5eaf0;padding:13px 16px 0}.chattito-panel__tours strong{display:block;margin-bottom:8px;color:#33475b;font-size:11px;letter-spacing:.06em;text-transform:uppercase}.chattito-panel__tours div{display:flex;flex-wrap:wrap;gap:7px}.chattito-panel__tours button{border:1px solid #b9dce4;border-radius:8px;background:#eaf7f9;padding:7px 9px;color:#006e84;font-size:11px;font-weight:700}.chattito-panel__tours button:hover{border-color:#0091ae;background:#d9f0f4}.chattito-panel__tours button:focus-visible{outline:2px solid #0091ae;outline-offset:2px}
.chattito-panel__tour-help{margin:8px 0 0;color:#516f90;font-size:11px;line-height:1.45}
.chattito-panel__help-preference{display:flex;align-items:center;gap:7px;margin-bottom:12px;color:#516f90;font-size:12px}.chattito-panel__help-preference input:focus-visible{outline:2px solid #0091ae;outline-offset:2px}.chattito-message p{white-space:pre-line}
.chattito-message__resume{display:block;margin-top:9px;border:1px solid #0091ae;border-radius:7px;background:#eaf7f9;padding:6px 9px;color:#006e84;font-size:11px;font-weight:700}.chattito-message__resume:hover{background:#d9f0f4}.chattito-message__resume:focus-visible{outline:2px solid #0091ae;outline-offset:2px}
@media(max-width:1023px){.chattito-panel{width:100vw}.chattito-panel__resize{display:none}}
@media(prefers-reduced-motion:reduce){.chattito-panel-enter-active,.chattito-panel-leave-active,.chattito-message-move,.chattito-message-enter-active,.chattito-message-leave-active{transition:none}}
</style>
