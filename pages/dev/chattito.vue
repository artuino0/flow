<script setup lang="ts">
import type { ChattitoLookAt, ChattitoState } from '~/utils/chattito'
import { chattitoTransientDuration, emotionForMessage, isAnimatedChattitoMessage, lookAtElement } from '~/utils/chattito'

definePageMeta({ layout: false })
const isDevelopment = import.meta.dev
const { startTour, canLaunchTour } = useOnboarding()
const state = ref<ChattitoState>('idle')
const lookAt = ref<ChattitoLookAt>('center')
const example = ref('Hola, muchas gracias')
const examples = ref([
  { role: 'assistant', text: '¡Hola! Soy Chattito.' },
  { role: 'user', text: '¿Me ayudas con esto?' },
  { role: 'assistant', text: 'Claro, dime qué necesitas.' },
  { role: 'user', text: 'Perfecto, gracias.' },
  { role: 'assistant', text: 'Con gusto. Prueba el gesto de este último mensaje.' },
])
const lastAssistantIndex = computed(() => examples.value.reduce((last, message, index) => message.role === 'assistant' ? index : last, -1))
const greetings = ['left', 'right', 'center'] as const
let assistantCounter = 3
let emotionTimer: ReturnType<typeof setTimeout> | undefined

watch(state, next => {
  if (emotionTimer) clearTimeout(emotionTimer)
  emotionTimer = undefined
  const duration = chattitoTransientDuration(next)
  if (duration !== null) emotionTimer = setTimeout(() => { state.value = 'idle' }, duration)
})

function setDirection(direction: typeof greetings[number]) {
  lookAt.value = direction
}
function aimAtButton(event: MouseEvent) {
  lookAt.value = lookAtElement(event.currentTarget as HTMLElement)
}
function previewEmotion() {
  state.value = emotionForMessage(example.value, examples.value.length === 0)
}
function addExample() {
  examples.value.push({ role: 'user', text: `Mensaje ${assistantCounter}` })
  examples.value.push({ role: 'assistant', text: `Respuesta ${assistantCounter}: solo yo tengo movimiento.` })
  assistantCounter += 1
}

onMounted(() => {
  if (!isDevelopment) void navigateTo('/')
})
onBeforeUnmount(() => { if (emotionTimer) clearTimeout(emotionTimer) })
</script>

<template>
  <main v-if="isDevelopment" class="chattito-lab">
    <header><p>FLOW · LABORATORIO DE MOVIMIENTO</p><h1>Chattito en movimiento</h1><span>Gestos aprobados · una sola instancia animada</span></header>
    <section class="chattito-lab__tour-actions" aria-label="Recorridos de prueba"><strong>Recorridos</strong><button type="button" @click="startTour('bienvenida')">Repetir bienvenida</button><button v-if="canLaunchTour('primer-modulo')" type="button" @click="startTour('primer-modulo')">Cómo crear mi primer módulo</button><button v-if="canLaunchTour('crear-modulo-manual')" type="button" @click="startTour('crear-modulo-manual')">Crear un módulo manualmente</button></section>
    <section class="chattito-lab__preview">
      <div class="chattito-lab__stage"><ChattitoAvatar :state="state" :look-at="lookAt" size="lg" /></div>
      <div class="chattito-lab__controls">
        <fieldset><legend>Gestos</legend><div class="chattito-lab__buttons">
          <button v-for="option in (['idle','happy','typing','special'] as const)" :key="option" type="button" :aria-pressed="state === option" @click="state = option">{{ option === 'special' ? 'Rebosante de felicidad' : option }}</button>
        </div></fieldset>
        <fieldset><legend>Mirada</legend><div class="chattito-lab__buttons"><button v-for="direction in greetings" :key="direction" type="button" @click="setDirection(direction)">{{ direction }}</button></div></fieldset>
        <fieldset><legend>Mirar elementos</legend><div class="chattito-lab__buttons"><button type="button" @click="aimAtButton">Mírame aquí</button><button type="button" @click="aimAtButton">Y aquí</button></div></fieldset>
        <fieldset><legend>Regla emocional</legend><label for="emotion-text">Texto de ejemplo</label><input id="emotion-text" v-model="example"><button type="button" @click="previewEmotion">Probar emoción</button><p>Resultado: <strong>{{ emotionForMessage(example, examples.length === 0) }}</strong></p></fieldset>
      </div>
    </section>
    <section class="chattito-lab__conversation"><div><h2>Relevo en conversación</h2><p>Los mensajes anteriores usan el símbolo quieto; solo el más reciente anima.</p></div><button type="button" @click="addExample">Agregar mensaje</button>
      <div class="chattito-lab__messages"><TransitionGroup name="lab-message"><article v-for="(message, index) in examples" :key="index" :class="`lab-message lab-message--${message.role}`"><ChattitoMessageAvatar v-if="message.role === 'assistant'" :animated="isAnimatedChattitoMessage(index, lastAssistantIndex)" :state="isAnimatedChattitoMessage(index, lastAssistantIndex) ? state : 'idle'" /><p>{{ message.text }}</p></article></TransitionGroup></div>
    </section>
  </main>
</template>

<style scoped>
.chattito-lab__tour-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:-6px 0 20px}.chattito-lab__tour-actions strong{margin-right:4px;color:#516f90;font-size:12px}.chattito-lab__tour-actions button{border:1px solid #b9dce4;border-radius:8px;background:#eaf7f9;padding:8px 12px;color:#006e84;font-size:12px;font-weight:700}.chattito-lab__tour-actions button:hover{border-color:#0091ae;background:#d9f0f4}.chattito-lab__tour-actions button:focus-visible{outline:2px solid #0091ae;outline-offset:2px}
.chattito-lab{min-height:100vh;background:#f5f8fa;padding:36px clamp(18px,5vw,72px);color:#213343}.chattito-lab header{margin-bottom:24px}.chattito-lab header p{color:#516f90;font-size:11px;font-weight:700;letter-spacing:.12em}.chattito-lab h1{margin:0;font-size:28px}.chattito-lab header span{display:block;margin-top:8px;color:#516f90;font-size:13px}.chattito-lab__preview,.chattito-lab__conversation{overflow:hidden;border:1px solid #d9e2eb;border-radius:16px;background:#fdfefe}.chattito-lab__preview{display:grid;grid-template-columns:minmax(0,1fr) 320px}.chattito-lab__stage{display:grid;min-height:430px;place-items:center;background:#edf3f6}.chattito-lab__controls{display:grid;align-content:start;gap:20px;border-left:1px solid #d9e2eb;padding:22px}.chattito-lab fieldset{display:grid;gap:10px;border:0;padding:0}.chattito-lab legend{margin-bottom:10px;font-size:12px;font-weight:700}.chattito-lab__buttons{display:flex;flex-wrap:wrap;gap:7px}.chattito-lab button,.chattito-lab input{min-height:34px;border:1px solid #cbd6e2;border-radius:8px;background:#fff;padding:6px 10px;color:#33475b;font-size:12px}.chattito-lab button[aria-pressed=true]{border-color:#0091ae;background:#e5f5f8;color:#006c83}.chattito-lab input{width:100%}.chattito-lab__conversation{margin-top:20px;padding:20px}.chattito-lab__conversation>div:first-child{display:inline-block}.chattito-lab h2{margin:0;font-size:16px}.chattito-lab__conversation>div:first-child p{margin:6px 0 0;color:#516f90;font-size:12px}.chattito-lab__conversation>button{float:right;background:#0091ae;color:white}.chattito-lab__messages{display:grid;gap:12px;margin-top:18px}.lab-message{display:flex;align-items:end;gap:8px}.lab-message p{margin:0;border:1px solid #e5eaf0;border-radius:12px;background:#f5f8fa;padding:9px 12px;font-size:13px}.lab-message--user{justify-content:flex-end}.lab-message--user p{background:#e5f5f8}.lab-message-move{transition:transform .25s ease}
@media(max-width:760px){.chattito-lab__preview{grid-template-columns:1fr}.chattito-lab__controls{border-top:1px solid #d9e2eb;border-left:0}.chattito-lab__stage{min-height:320px}}
</style>
