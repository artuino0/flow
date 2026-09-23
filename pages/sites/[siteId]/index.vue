<script setup lang="ts">
definePageMeta({ layout: 'default' })
const route = useRoute()
await navigateTo('/sites/' + String(route.params.siteId) + '/overview', { replace: true })
</script>
<template><div /></template>
