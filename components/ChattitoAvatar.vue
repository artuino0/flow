<script setup lang="ts">
import type { ChattitoLookAt, ChattitoState } from '~/utils/chattito'
import { chattitoSpringFrames, calculateChattitoLook, CHATTITO_DEFAULTS, chooseChattitoIdleGesture, nextChattitoIdleDelay } from '~/utils/chattito'

const props = withDefaults(defineProps<{
  state?: ChattitoState
  lookAt?: ChattitoLookAt
  size?: 'sm' | 'md' | 'lg'
  autoIdle?: boolean
}>(), { state: 'idle', size: 'md', autoIdle: false })

const svg = ref<SVGSVGElement>()
const shownState = ref<ChattitoState>(props.state)
let observer: IntersectionObserver | undefined
let animations: Animation[] = []
const animationTargets = new Map<string, Animation>()
let blinkTimer: ReturnType<typeof setTimeout> | undefined
let idleTimer: ReturnType<typeof setTimeout> | undefined
let returnTimer: ReturnType<typeof setTimeout> | undefined
let visible = false
let reduced = false
const media = import.meta.client ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined

function element(selector: string) { return svg.value?.querySelector<SVGElement>(selector) }
function cancelAnimations() {
  animations.forEach(animation => animation.cancel())
  animations = []
  animationTargets.clear()
  if (blinkTimer) clearTimeout(blinkTimer)
  blinkTimer = undefined
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = undefined
  if (returnTimer) clearTimeout(returnTimer)
  returnTimer = undefined
}
function animate(target: string, frames: Keyframe[], options: KeyframeAnimationOptions) {
  const node = element(target)
  if (!node || !visible || document.hidden || reduced) return
  const previous = animationTargets.get(target)
  if (previous) {
    previous.cancel()
    animations = animations.filter(active => active !== previous)
  }
  const animation = node.animate(frames, { fill: 'both', ...options })
  animationTargets.set(target, animation)
  animations.push(animation)
  animation.onfinish = () => {
    if (!options.iterations || options.iterations === 1) {
      const final = frames.at(-1)
      if (typeof final?.transform === 'string') node.style.transform = final.transform
      if (typeof final?.opacity === 'number' || typeof final?.opacity === 'string') node.style.opacity = String(final.opacity)
      animation.cancel()
      animations = animations.filter(active => active !== animation)
      if (animationTargets.get(target) === animation) animationTargets.delete(target)
    }
  }
}
function handleMotionChange() {
  if (!media) return
  reduced = media.matches
  shownState.value = props.state
  playState()
}
function scheduleBlink() {
  if (!visible || !svg.value || document.hidden) return
  const delay = reduced ? CHATTITO_DEFAULTS.reducedBlinkInterval : CHATTITO_DEFAULTS.blinkMinInterval + Math.random() * (CHATTITO_DEFAULTS.blinkMaxInterval - CHATTITO_DEFAULTS.blinkMinInterval)
  blinkTimer = setTimeout(() => {
    const duration = reduced ? CHATTITO_DEFAULTS.reducedBlinkDuration : CHATTITO_DEFAULTS.blinkDuration
    const double = !reduced && Math.random() < CHATTITO_DEFAULTS.doubleBlinkChance
    const total = double ? duration * 2 + CHATTITO_DEFAULTS.doubleBlinkGap : duration
    const frames: Keyframe[] = [
      { transform: 'scaleY(1)', offset: 0 },
      { transform: 'scaleY(.1)', offset: duration / 2 / total },
      { transform: 'scaleY(1)', offset: duration / total },
    ]
    if (double) frames.push(
      { transform: 'scaleY(1)', offset: (duration + CHATTITO_DEFAULTS.doubleBlinkGap) / total },
      { transform: 'scaleY(.1)', offset: (duration * 1.5 + CHATTITO_DEFAULTS.doubleBlinkGap) / total },
      { transform: 'scaleY(1)', offset: 1 },
    )
    if (visible && !document.hidden && svg.value) {
      const animation = element('.chattito-eyelids')?.animate(frames, { duration: total, easing: 'ease-in-out' })
      if (animation) {
        animations.push(animation)
        animation.onfinish = () => { animations = animations.filter(active => active !== animation) }
      }
    }
    scheduleBlink()
  }, delay)
}
function applyLook(target: ChattitoLookAt = props.lookAt ?? 'center') {
  if (!svg.value || reduced || shownState.value === 'special') return
  const bounds = svg.value.getBoundingClientRect()
  const look = calculateChattitoLook(target, bounds, CHATTITO_DEFAULTS)
  const spring = chattitoSpringFrames(CHATTITO_DEFAULTS.springStiffness, CHATTITO_DEFAULTS.springDamping)
  const currentMatrix = (selector: string) => {
    const transform = getComputedStyle(element(selector)!).transform
    return new DOMMatrixReadOnly(transform === 'none' ? undefined : transform)
  }
  const pupils = currentMatrix('.chattito-pupils')
  const head = currentMatrix('.chattito-head')
  const face = currentMatrix('.chattito-face')
  const rotation = Math.atan2(head.b, head.a) * 180 / Math.PI
  const direction = look.x / CHATTITO_DEFAULTS.pupilDistance
  animate('.chattito-pupils', spring.values.map((value, index) => ({ transform: `translate(${pupils.e + (look.x - pupils.e) * value}px, ${pupils.f + (look.y - pupils.f) * value}px)`, offset: index / (spring.values.length - 1) })), { duration: spring.duration, easing: 'linear' })
  animate('.chattito-head', spring.values.map((value, index) => ({ transform: `rotate(${rotation + (look.rotation - rotation) * value}deg)`, offset: index / (spring.values.length - 1) })), { duration: spring.duration, easing: 'linear' })
  animate('.chattito-face', spring.values.map((value, index) => ({ transform: `translateX(${face.e + (direction * 4.5 - face.e) * value}px) scaleX(${face.a + (1 - Math.abs(direction) * 9 / 85 - face.a) * value})`, offset: index / (spring.values.length - 1) })), { duration: spring.duration, easing: 'linear' })
}
function playState() {
  cancelAnimations()
  if (!visible || document.hidden || reduced || !svg.value) { scheduleBlink(); return }
  if (shownState.value === 'idle') {
    animate('.chattito-breathing', [{ transform: 'translateY(0)' }, { transform: `translateY(${-CHATTITO_DEFAULTS.breathingDistance}px)` }, { transform: 'translateY(0)' }], { duration: CHATTITO_DEFAULTS.breathingDuration, iterations: Infinity, easing: 'ease-in-out' })
    applyLook()
    scheduleIdleGesture()
  } else if (shownState.value === 'typing') {
    element('.chattito-dot')?.parentElement?.querySelectorAll('.chattito-dot').forEach((dot, index) => {
      if (!visible) return
      const animation = dot.animate([{ transform: 'translateY(0)', opacity: .35, offset: 0, easing: 'ease-in-out' }, { transform: `translateY(${-CHATTITO_DEFAULTS.typingDistance}px)`, opacity: 1, offset: 1 / 6, easing: 'ease-in-out' }, { transform: 'translateY(0)', opacity: .35, offset: 1 / 3 }, { transform: 'translateY(0)', opacity: .35, offset: 1 }], { duration: CHATTITO_DEFAULTS.typingDuration, iterations: Infinity, delay: CHATTITO_DEFAULTS.typingDuration * index / 3, easing: 'linear' })
      animations.push(animation)
    })
  } else if (shownState.value === 'happy') {
    if (props.lookAt !== undefined) applyLook()
    animate('.chattito-jump', [{ transform: 'none' }, { transform: `scale(${CHATTITO_DEFAULTS.happyStretch}, ${CHATTITO_DEFAULTS.happySquash})`, offset: .18 }, { transform: `translateY(${-CHATTITO_DEFAULTS.happyJump}px) scale(${CHATTITO_DEFAULTS.happySquash}, ${CHATTITO_DEFAULTS.happyStretch})`, offset: .48 }, { transform: `scale(${CHATTITO_DEFAULTS.happyStretch}, ${CHATTITO_DEFAULTS.happySquash})`, offset: .78 }, { transform: 'none' }], { duration: CHATTITO_DEFAULTS.happyDuration, easing: 'ease-in-out' })
    animate('.chattito-antenna', [{ transform: 'none' }, { transform: `rotate(${CHATTITO_DEFAULTS.antennaRotation}deg)`, offset: .25 }, { transform: `rotate(${-CHATTITO_DEFAULTS.antennaRotation}deg)`, offset: .5 }, { transform: `rotate(${CHATTITO_DEFAULTS.antennaRotation}deg)`, offset: .75 }, { transform: 'none' }], { duration: CHATTITO_DEFAULTS.happyDuration, easing: 'ease-in-out' })
  } else {
    const frames = Array.from({ length: 33 }, (_, index) => {
      const phase = index / 32 * Math.PI * 2
      return { transform: `translate(${Math.sin(phase) * CHATTITO_DEFAULTS.joySway}px, ${-(1 - Math.cos(phase)) / 2 * CHATTITO_DEFAULTS.joyHeight}px) rotate(${Math.sin(phase) * CHATTITO_DEFAULTS.joyRotation}deg)`, offset: index / 32 }
    })
    animate('.chattito-joy', frames, { duration: CHATTITO_DEFAULTS.joyDuration, iterations: Infinity, easing: 'linear' })
    const headFrames = Array.from({ length: 33 }, (_, index) => {
      const phase = index / 32 * Math.PI * 2
      return { transform: `rotate(${Math.sin(phase * 2) * CHATTITO_DEFAULTS.headRotation}deg)`, offset: index / 32 }
    })
    const antennaFrames = Array.from({ length: 33 }, (_, index) => ({ transform: `rotate(${Math.sin(index / 32 * Math.PI * 8) * CHATTITO_DEFAULTS.antennaRotation / 2}deg)`, offset: index / 32 }))
    animate('.chattito-head', headFrames, { duration: CHATTITO_DEFAULTS.joyDuration, iterations: Infinity, easing: 'linear' })
    animate('.chattito-antenna', antennaFrames, { duration: CHATTITO_DEFAULTS.joyDuration, iterations: Infinity, easing: 'linear' })
    applyLook('center')
  }
  scheduleBlink()
}
function scheduleIdleGesture() {
  if (!props.autoIdle || props.state !== 'idle' || props.lookAt !== undefined || shownState.value !== 'idle' || !visible || document.hidden || reduced) return
  idleTimer = setTimeout(() => {
    idleTimer = undefined
    if (!props.autoIdle || !visible || document.hidden || reduced || props.state !== 'idle' || props.lookAt !== undefined) return
    const gesture = chooseChattitoIdleGesture(Math.random())
    if (gesture === 'happy') {
      shownState.value = 'happy'
      playState()
      returnTimer = setTimeout(() => {
        shownState.value = 'idle'
        playState()
      }, CHATTITO_DEFAULTS.happyDuration)
      return
    }
    applyLook(gesture)
    returnTimer = setTimeout(() => {
      applyLook('center')
      returnTimer = undefined
      scheduleIdleGesture()
    }, 1100)
  }, nextChattitoIdleDelay(Math.random()))
}
function visibilityChanged() {
  if (!visible || document.hidden) {
    animations.forEach(animation => animation.pause())
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = undefined
    if (returnTimer) clearTimeout(returnTimer)
    returnTimer = undefined
    shownState.value = props.state
  } else playState()
}

watch(() => [props.state, props.lookAt, props.autoIdle], () => { shownState.value = props.state; playState() })
onMounted(() => {
  reduced = Boolean(media?.matches)
  observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; visibilityChanged() })
  if (svg.value) observer.observe(svg.value)
  media?.addEventListener('change', handleMotionChange)
  document.addEventListener('visibilitychange', visibilityChanged)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  cancelAnimations()
  media?.removeEventListener('change', handleMotionChange)
  document.removeEventListener('visibilitychange', visibilityChanged)
})
</script>

<template>
  <svg ref="svg" viewBox="0 0 200 200" role="img" :aria-label="`Chattito ${shownState}`" :data-state="shownState" :class="['chattito-avatar', `chattito-avatar--${size}`]" focusable="false">
    <ChattitoArtwork />
  </svg>
</template>

<style>
.chattito-avatar{display:block;flex:none;overflow:visible}.chattito-avatar--sm{width:42px;height:42px}.chattito-avatar--md{width:78px;height:78px}.chattito-avatar--lg{width:150px;height:150px}
.chattito-avatar .chattito-jump,.chattito-avatar .chattito-joy,.chattito-avatar .chattito-head{transform-origin:104.825px 157.05px}.chattito-avatar .chattito-antenna{transform-origin:104.825px 80px}.chattito-avatar .chattito-face{transform-origin:104.825px 119.625px}.chattito-avatar .chattito-eyelids,.chattito-avatar .chattito-pupils{transform-origin:104px 120px}
.chattito-avatar .chattito-eyes-happy,.chattito-avatar .chattito-dots{opacity:0;transition:opacity 250ms ease-in-out}
.chattito-avatar[data-state="happy"] .chattito-eyes-normal,.chattito-avatar[data-state="special"] .chattito-eyes-normal,.chattito-avatar[data-state="typing"] .chattito-eyes-normal{opacity:0}
.chattito-avatar[data-state="happy"] .chattito-eyes-happy,.chattito-avatar[data-state="special"] .chattito-eyes-happy,.chattito-avatar[data-state="typing"] .chattito-dots{opacity:1}
@media(prefers-reduced-motion:reduce){.chattito-avatar *{transition:none!important}}
</style>
