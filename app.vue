<script setup lang="ts">
import { chattitoSessionIdentity } from '~/utils/chattito'
import { onboardingSessionIdentity, shouldResetOnboarding } from '~/utils/onboardingTours'

const showNavigationFeedback = ref(false)
const { panel: chattitoPanel, reset: resetChattito } = useChattitoPanel()
const { reset: resetOnboarding } = useOnboarding()
const { user } = useAuth()
const { data: isAdmin } = useIsAdmin()
const route = useRoute()
const sessionIdentity = computed(() => chattitoSessionIdentity(user.value))
const onboardingIdentity = computed(() => onboardingSessionIdentity(user.value))
const showChattito = computed(() => Boolean(sessionIdentity.value) && route.meta.layout !== false && user.value?.emailVerified && user.value?.onboardingStatus === 'complete')
watch(sessionIdentity, (current, previous) => {
  if (shouldResetOnboarding(current, previous)) resetChattito()
}, { immediate: true, flush: 'sync' })
watch(onboardingIdentity, (current, previous) => {
  if (shouldResetOnboarding(current, previous)) resetOnboarding()
}, { immediate: true, flush: 'sync' })
watch(isAdmin, (current, previous) => {
  if (typeof current === 'boolean' && typeof previous === 'boolean' && current !== previous) resetOnboarding()
})
let feedbackTimer: ReturnType<typeof setTimeout> | undefined

function startNavigationFeedback() {
  if (feedbackTimer) clearTimeout(feedbackTimer)
  feedbackTimer = setTimeout(() => { showNavigationFeedback.value = true }, 180)
}
function stopNavigationFeedback() {
  if (feedbackTimer) clearTimeout(feedbackTimer)
  feedbackTimer = undefined
  showNavigationFeedback.value = false
}

if (import.meta.client) {
  const nuxtApp = useNuxtApp()
  nuxtApp.hook('page:start', startNavigationFeedback)
  nuxtApp.hook('page:finish', stopNavigationFeedback)
  nuxtApp.hook('vue:error', stopNavigationFeedback)
}

onBeforeUnmount(stopNavigationFeedback)
</script>

<template>
  <ChattitoSymbolRegistry v-if="sessionIdentity" />
  <OnboardingTour v-if="showChattito" />
  <ChattitoHelp v-if="showChattito" />
  <NuxtLoadingIndicator color="#0091AE" :height="3" :throttle="0" :duration="1600" />
  <Transition name="navigation-feedback">
    <div v-if="showNavigationFeedback" class="navigation-feedback" role="status" aria-live="polite">
      <span class="navigation-spinner" />
      Cargando…
    </div>
  </Transition>
  <div class="chattito-app-shell">
    <div class="chattito-app-content">
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
    </div>
    <div v-if="showChattito" class="chattito-panel-slot" :class="{ 'chattito-panel-slot--open': chattitoPanel.open, 'chattito-panel-slot--resizing': chattitoPanel.resizing }" :style="{ '--chattito-panel-width': `${chattitoPanel.width}px` }">
      <ChattitoPanel />
    </div>
  </div>
</template>

<style>
.chattito-app-shell{display:flex;width:100%;height:100dvh;overflow:hidden}.chattito-app-content{min-width:0;flex:1;overflow:hidden}.chattito-panel-slot{width:0;min-width:0;flex:none;overflow:hidden;transition:width .24s cubic-bezier(.22,1,.36,1)}.chattito-panel-slot--open{width:var(--chattito-panel-width)}.chattito-panel-slot--resizing{transition:none}
@media(max-width:1023px){.chattito-panel-slot{position:fixed;z-index:190;inset:0 0 0 auto;height:100dvh}.chattito-panel-slot--open{width:100vw}}
@media(prefers-reduced-motion:reduce){.chattito-panel-slot{transition:none}}
.navigation-feedback{position:fixed;z-index:200;top:68px;right:20px;display:flex;align-items:center;gap:8px;height:34px;border:1px solid #e5eaf0;border-radius:6px;background:#fff;padding:0 12px;box-shadow:0 6px 18px #33475b1f;color:#516f90;font-size:12px;font-weight:600;pointer-events:none}
.navigation-spinner{width:14px;height:14px;border:2px solid #cfe4e9;border-top-color:#0091ae;border-radius:50%;animation:navigation-spin .7s linear infinite}
.navigation-feedback-enter-active,.navigation-feedback-leave-active{transition:opacity .12s ease,transform .12s ease}.navigation-feedback-enter-from,.navigation-feedback-leave-to{opacity:0;transform:translateY(-4px)}
@keyframes navigation-spin{to{transform:rotate(360deg)}}
@media(max-width:640px){.navigation-feedback{top:64px;right:12px}}
</style>
