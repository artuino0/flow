<script setup lang="ts">
const { panel, toggle } = useChattitoPanel()
</script>

<template>
  <button type="button" class="chattito-toggle" aria-label="Abrir Chattito" :aria-expanded="panel.open" @click="toggle">
    <ChattitoAvatar v-if="!panel.open" state="idle" size="sm" auto-idle />
    <svg v-else viewBox="0 0 200 200" aria-hidden="true" class="chattito-toggle__still"><use href="#chattito-symbol" /></svg>
  </button>
</template>

<style scoped>
.chattito-toggle{display:flex;width:44px;height:44px;flex:none;align-items:center;justify-content:center;border-radius:8px;color:#33475b;transition:background .15s ease}.chattito-toggle:hover{background:#f5f8fa}.chattito-toggle__still{width:42px;height:42px;flex:none}
</style>
