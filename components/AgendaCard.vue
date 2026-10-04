<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>
<template>
  <section class="agenda-ui settings-card agenda-card" data-dark-ready="true">
    <header class="agenda-card-heading"><div><h2>{{ title }}</h2><p v-if="description">{{ description }}</p></div><slot name="actions" /></header>
    <div class="agenda-card-body"><slot /></div>
    <slot name="footer" />
  </section>
</template>
