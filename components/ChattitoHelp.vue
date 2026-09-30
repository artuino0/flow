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
.chattito-help-host{position:fixed;z-index:180;top:64px;right:16px;width:min(360px,calc(100vw - 32px))}.chattito-help{border:1px solid var(--help-border,#d9e2eb);border-radius:8px;background:#fdfefe;padding:16px;box-shadow:0 4px 16px #33475b14;color:#213343}.chattito-help__label{font-size:11px;color:#516f90}.chattito-help h2{margin:8px 0 6px;font-size:15px;font-weight:700}.chattito-help p{margin:0;font-size:13px;line-height:1.5}.chattito-help__actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.chattito-help__actions button{border:1px solid #b9dce4;border-radius:6px;background:#eaf7f9;padding:7px 9px;color:#006e84;font-size:12px}.chattito-help__actions button:hover{background:#d9f0f4}.chattito-help__disable{margin-top:12px;color:#516f90;font-size:11px;text-decoration:underline}.chattito-help button:focus-visible{outline:2px solid #0091ae;outline-offset:3px}.chattito-help__disable:hover{color:#213343}
</style>
