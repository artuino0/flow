<script setup lang="ts">
definePageMeta({ layout: 'default', fullBleed: true })
const route = useRoute()
const siteId = computed(() => String(route.params.siteId))
</script>

<template>
  <SitesFormManager :site-id="siteId" />
</template>
