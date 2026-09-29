<script setup lang="ts">
import { emotionForMessage, isAnimatedChattitoMessage } from '~/utils/chattito'
import { CHATTITO_MAX_WIDTH, CHATTITO_MIN_WIDTH } from '~/composables/useChattitoPanel'

const { panel, close, addMessage, setAvatarState, disposeAvatarStateTimer, setWidth, restoreWidth, saveWidth } = useChattitoPanel()
const draft = ref('')
const list = ref<HTMLElement>()
const pending = ref(false)
let responseTimer: ReturnType<typeof setTimeout> | undefined
let resizeStartX = 0
let resizeStartWidth = CHATTITO_MIN_WIDTH

const lastChattitoIndex = computed(() => panel.value.messages.reduce((last, message, index) => message.role === 'assistant' ? index : last, -1))
const visibleMessages = computed(() => panel.value.messages.slice(-30))
const visibleOffset = computed(() => panel.value.messages.length - visibleMessages.value.length)

watch(() => [panel.value.open, panel.value.messages.length], async () => {
  await nextTick()
  if (list.value) list.value.scrollTop = list.value.scrollHeight
})

function send() {
  const text = draft.value.trim()
  if (!text || pending.value) return
  const isFirst = !panel.value.messages.some(message => message.role === 'user')
  const emotion = emotionForMessage(text, isFirst)
  addMessage({ role: 'user', text })
  addMessage({ role: 'assistant', text: '', emotion: 'typing' })
  setAvatarState('typing')
  pending.value = true
  draft.value = ''
  responseTimer = setTimeout(() => {
    panel.value.messages.pop()
    const response = '¡Listo! Esta respuesta local simula la conversación y sus animaciones.'
    addMessage({ role: 'assistant', text: response, emotion })
    setAvatarState(emotion)
    pending.value = false
  }, 1400)
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
  if (responseTimer) clearTimeout(responseTimer)
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
            <ChattitoMessageAvatar v-if="message.role === 'assistant'" :animated="isAnimatedChattitoMessage(index + visibleOffset, lastChattitoIndex)" :state="message.emotion === 'typing' ? 'typing' : panel.avatarState" size="md" />
            <span v-if="message.emotion === 'typing'" class="sr-only">Chattito está escribiendo</span>
            <p v-else>{{ message.text }}</p>
          </article>
        </TransitionGroup>
      </div>
      <form class="chattito-panel__composer" @submit.prevent="send">
        <label class="sr-only" for="chattito-message">Escribe a Chattito</label>
        <input id="chattito-message" v-model="draft" autocomplete="off" placeholder="Escribe un mensaje…" :disabled="pending">
        <button type="submit" :disabled="!draft.trim() || pending" aria-label="Enviar mensaje">↑</button>
      </form>
      <p class="chattito-panel__footnote">Conversación local de prueba · Sin IA</p>
    </aside>
  </Transition>
</template>

<style>
.chattito-panel{position:relative;display:flex;width:var(--chattito-panel-width,400px);height:100%;flex-direction:column;border-left:1px solid #d9e2eb;background:#fdfefe;color:#213343}.chattito-panel__resize{position:absolute;z-index:1;top:0;bottom:0;left:0;width:12px;cursor:col-resize;touch-action:none}.chattito-panel__resize::after{position:absolute;top:50%;left:4px;width:3px;height:36px;border-radius:3px;background:#cbd6e2;content:"";transform:translateY(-50%)}.chattito-panel__resize:hover::after,.chattito-panel__resize:focus-visible::after{background:#0091ae}.chattito-panel__resize:focus-visible{outline:2px solid #0091ae;outline-offset:-2px}.chattito-panel__header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5eaf0;padding:16px 18px}.chattito-panel__identity{display:flex;align-items:center;gap:12px}.chattito-panel__avatar{width:56px;height:56px;flex:none}.chattito-panel__identity div{display:grid;gap:3px}.chattito-panel__identity strong{font-size:14px}.chattito-panel__identity span,.chattito-panel__footnote{font-size:11px;color:#718096}.chattito-panel__close{width:32px;height:32px;border-radius:7px;color:#516f90;font-size:24px;line-height:1}.chattito-panel__close:hover{background:#edf3f6}.chattito-panel__messages{display:flex;min-height:0;flex:1;flex-direction:column;gap:12px;overflow:auto;padding:14px 16px;scrollbar-width:thin;scrollbar-color:#cbd6e2 transparent}.chattito-message{display:flex;align-items:center;gap:4px;content-visibility:auto;contain-intrinsic-size:auto 104px}.chattito-message p{max-width:82%;margin:0;border:1px solid #e5eaf0;border-radius:14px 14px 14px 4px;background:#f5f8fa;padding:10px 12px;font-size:13px;line-height:1.5}.chattito-message--user{justify-content:flex-end;min-height:42px}.chattito-message--user p{border-color:#cdebf0;border-radius:14px 14px 4px 14px;background:#e5f5f8;color:#214e59}.chattito-panel__composer{display:flex;gap:8px;border:1px solid #d9e2eb;border-radius:12px;margin:14px 14px 0;padding:6px;background:white}.chattito-panel__composer input{min-width:0;flex:1;border:0;background:transparent;padding:7px;font-size:13px;outline:none}.chattito-panel__composer button{width:34px;height:34px;border-radius:9px;background:#0091ae;color:white;font-size:20px}.chattito-panel__composer button:disabled{opacity:.45}.chattito-panel__footnote{margin:8px 16px 13px;text-align:center}.chattito-panel-enter-active,.chattito-panel-leave-active{transition:opacity .22s ease}.chattito-panel-enter-from,.chattito-panel-leave-to{opacity:0}.chattito-message-move{transition:transform .28s ease}.chattito-message-enter-active,.chattito-message-leave-active{transition:opacity .2s ease,transform .2s ease}.chattito-message-enter-from,.chattito-message-leave-to{opacity:0;transform:translateY(8px)}
.chattito-panel__avatar{width:42px;height:42px}.chattito-message{contain-intrinsic-size:auto 78px}
@media(max-width:1023px){.chattito-panel{width:100vw}.chattito-panel__resize{display:none}}
@media(prefers-reduced-motion:reduce){.chattito-panel-enter-active,.chattito-panel-leave-active,.chattito-message-move,.chattito-message-enter-active,.chattito-message-leave-active{transition:none}}
</style>
