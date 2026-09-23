<script setup lang="ts">
const showNavigationFeedback = ref(false)
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
  <NuxtLoadingIndicator color="#0091AE" :height="3" :throttle="0" :duration="1600" />
  <Transition name="navigation-feedback">
    <div v-if="showNavigationFeedback" class="navigation-feedback" role="status" aria-live="polite">
      <span class="navigation-spinner" />
      Cargando…
    </div>
  </Transition>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<style>
.navigation-feedback{position:fixed;z-index:200;top:68px;right:20px;display:flex;align-items:center;gap:8px;height:34px;border:1px solid #e5eaf0;border-radius:6px;background:#fff;padding:0 12px;box-shadow:0 6px 18px #33475b1f;color:#516f90;font-size:12px;font-weight:600;pointer-events:none}
.navigation-spinner{width:14px;height:14px;border:2px solid #cfe4e9;border-top-color:#0091ae;border-radius:50%;animation:navigation-spin .7s linear infinite}
.navigation-feedback-enter-active,.navigation-feedback-leave-active{transition:opacity .12s ease,transform .12s ease}.navigation-feedback-enter-from,.navigation-feedback-leave-to{opacity:0;transform:translateY(-4px)}
@keyframes navigation-spin{to{transform:rotate(360deg)}}
@media(max-width:640px){.navigation-feedback{top:64px;right:12px}}
</style>
