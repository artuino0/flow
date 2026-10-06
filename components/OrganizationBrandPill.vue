<script setup lang="ts">
const props = defineProps<{
  organizationName: string
  hasLogo?: boolean
  isAdmin?: boolean
}>()

const initials = computed(() => props.organizationName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?')
const logoUrl = '/api/tenant/logo'
</script>

<template>
  <NuxtLink
    v-if="isAdmin"
    to="/ajustes?section=identidad"
    :aria-label="`Identidad visual de ${organizationName}`"
    :title="organizationName"
    class="inline-flex h-9 min-w-0 max-w-[220px] shrink items-center gap-2 rounded-full border border-brand-border-light bg-brand-neutral-bg px-2 text-brand-text-secondary transition-colors hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue sm:max-w-[240px]"
  >
    <span class="flex h-[22px] w-[22px] shrink-0 items-center justify-center overflow-hidden" :class="hasLogo ? 'theme-light rounded border border-brand-border-light bg-brand-surface' : 'rounded-full bg-brand-blue-bg'">
      <img v-if="hasLogo" :src="logoUrl" alt="" class="h-full w-full object-contain" />
      <span v-else aria-hidden="true" class="text-[9px] font-bold leading-none text-brand-blue">{{ initials }}</span>
    </span>
    <span class="sr-only min-w-0 truncate text-xs font-medium sm:not-sr-only sm:max-w-[180px]">{{ organizationName }}</span>
  </NuxtLink>
  <div
    v-else
    :aria-label="organizationName"
    :title="organizationName"
    class="inline-flex h-9 min-w-0 max-w-[220px] shrink items-center gap-2 rounded-full border border-brand-border-light bg-brand-neutral-bg px-2 text-brand-text-secondary sm:max-w-[240px]"
  >
    <span class="flex h-[22px] w-[22px] shrink-0 items-center justify-center overflow-hidden" :class="hasLogo ? 'theme-light rounded border border-brand-border-light bg-brand-surface' : 'rounded-full bg-brand-blue-bg'">
      <img v-if="hasLogo" :src="logoUrl" alt="" class="h-full w-full object-contain" />
      <span v-else aria-hidden="true" class="text-[9px] font-bold leading-none text-brand-blue">{{ initials }}</span>
    </span>
    <span class="sr-only min-w-0 truncate text-xs font-medium sm:not-sr-only sm:max-w-[180px]">{{ organizationName }}</span>
  </div>
</template>
