<script setup lang="ts">
definePageMeta({ layout: 'default', darkReady: true })

const route = useRoute()
const slug = route.params.entity as string
const { data, pending, error: fetchError } = await useEntityFields(slug)
const returnTo = computed(() => {
  const from = typeof route.query.from === 'string' ? route.query.from : ''
  return /^\/registros\/[A-Za-z0-9_-]+\/[0-9a-fA-F-]{36}$/.test(from) ? from : `/registros/${slug}`
})

async function onCreated(result: { id?: string }) {
  if (result.id) await navigateTo(`/registros/${slug}/${result.id}`)
  else await navigateTo(returnTo.value)
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex items-center gap-1 text-[13px]">
      <span class="text-brand-text-secondary">Inicio</span>
      <NuxtLink :to="`/registros/${slug}`" class="text-brand-text-secondary hover:underline">{{ data?.entity?.name || slug }}</NuxtLink>
      <span class="text-brand-text-muted">/</span>
      <span class="font-bold text-brand-text">Nuevo</span>
    </div>
    <RecordCreateForm :slug="slug" :data="data" :pending="pending" :fetch-error="fetchError" :initial-values="route.query" :return-to="returnTo" @created="onCreated" />
  </div>
</template>
