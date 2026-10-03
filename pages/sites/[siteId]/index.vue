<script setup lang="ts">
definePageMeta({ layout: 'default', darkReady: true })
const route = useRoute()
await navigateTo('/sites/' + String(route.params.siteId) + '/overview', { replace: true })
</script>
<template><div /></template>
