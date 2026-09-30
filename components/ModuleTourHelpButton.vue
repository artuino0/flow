<script setup lang="ts">
import { CircleHelp } from '@lucide/vue'
import type { ModuleEditTab } from '~/utils/moduleEditTabs'
import { chattitoHelpCatalog } from '~/utils/chattitoHelp'

const props = defineProps<{ tab: ModuleEditTab }>()
const { available, disabled, launch } = useModuleTourHelp(props.tab)
const label = computed(() => `Ver recorrido de ${chattitoHelpCatalog[`module-edit:${props.tab}`].title}`)
</script>

<template>
  <button v-if="available" type="button" :aria-label="label" title="Ver recorrido" :disabled="disabled" class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-brand-text-muted hover:text-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue disabled:cursor-default disabled:opacity-50" @click="launch">
    <CircleHelp class="h-[18px] w-[18px]" :stroke-width="1.75" aria-hidden="true" />
  </button>
</template>
