<script setup lang="ts">
definePageMeta({ layout: 'default', darkReady: true, fullBleed: true })
const route = useRoute()
const siteId = computed(() => String(route.params.siteId))
</script>

<template>
  <SitesPageManager :site-id="siteId" kind="website" />
</template>
