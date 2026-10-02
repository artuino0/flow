<script setup lang="ts">
const { help, visible, tourId, dismiss, explain, runTour, disable } = useChattitoHelp()
</script>

<template>
  <div class="chattito-help-host" aria-live="polite" aria-atomic="true">
    <section v-if="visible && help" class="chattito-help" aria-label="Ayuda de Chattito">
      <span class="chattito-help__label">Chattito · Ayuda de esta pantalla</span>
      <h2>{{ help.title }}</h2>
      <p>{{ help.summary }}</p>
      <div class="chattito-help__actions">
        <button v-if="tourId" type="button" @click="runTour">Ver recorrido</button>
        <button type="button" @click="explain">Explícame más</button>
        <button type="button" @click="dismiss">No mostrar más aquí</button>
      </div>
      <button type="button" class="chattito-help__disable" @click="disable">No me sugieras más ayuda</button>
    </section>
  </div>
</template>

<style scoped>
.chattito-help-host{position:fixed;z-index:180;top:64px;right:16px;width:min(360px,calc(100vw - 32px))}.chattito-help{border:1px solid var(--help-border,rgb(var(--brand-panel-border)));border-radius:8px;background:rgb(var(--brand-panel-soft));padding:16px;box-shadow:0 4px 16px #33475b14;color:rgb(var(--brand-navy))}.chattito-help__label{font-size:11px;color:rgb(var(--brand-text-secondary))}.chattito-help h2{margin:8px 0 6px;font-size:15px;font-weight:700}.chattito-help p{margin:0;font-size:13px;line-height:1.5}.chattito-help__actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.chattito-help__actions button{border:1px solid rgb(var(--brand-help-border));border-radius:6px;background:rgb(var(--brand-help-bg));padding:7px 9px;color:rgb(var(--brand-help-text));font-size:12px}.chattito-help__actions button:hover{background:rgb(var(--brand-help-hover))}.chattito-help__disable{margin-top:12px;color:rgb(var(--brand-text-secondary));font-size:11px;text-decoration:underline}.chattito-help button:focus-visible{outline:2px solid rgb(var(--brand-blue));outline-offset:3px}.chattito-help__disable:hover{color:rgb(var(--brand-navy))}
</style>
