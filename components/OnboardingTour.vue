<script setup lang="ts">
const route = useRoute()
const { activeId, sessionIdentity, startWelcomeOnce, stopTour, handleRouteChange } = useOnboarding()

onMounted(() => { void nextTick().then(startWelcomeOnce) })
watch(() => route.fullPath, () => {
  if (activeId.value) handleRouteChange()
  void nextTick().then(startWelcomeOnce)
})
watch(sessionIdentity, () => { void nextTick().then(startWelcomeOnce) })
onBeforeUnmount(stopTour)
</script>

<template><span class="sr-only" aria-live="polite">{{ activeId ? 'Recorrido en curso' : '' }}</span></template>
