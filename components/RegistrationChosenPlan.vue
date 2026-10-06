<script setup lang="ts">
import { CalendarCheck } from '@lucide/vue'
defineProps<{ chosenPlan?: { key: string; name: string }; chosenPrice: string; choice: { interval: string } | null; loading: boolean; choiceError?: string }>()
const emit = defineEmits<{ change: [] }>()
</script>
<template>
        <section v-if="chosenPlan" aria-label="Plan elegido" class="flex w-full items-center gap-3 rounded-lg bg-brand-blue-bg px-[14px] py-3 text-brand-text">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-surface">
            <CalendarCheck class="h-[18px] w-[18px] text-brand-blue" :stroke-width="1.75" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-[10px] font-bold tracking-[0.06em] text-brand-blue">PLAN ELEGIDO</p>
            <p class="text-sm font-bold">{{ chosenPlan.name }} · {{ chosenPrice }} MXN {{ choice?.interval === 'year' ? 'al año' : 'al mes' }}</p>
            <p class="text-xs text-brand-text-secondary">30 días de prueba gratis</p>
          </div>
          <button type="button" :disabled="loading" aria-label="Cambiar plan" class="shrink-0 rounded bg-brand-surface px-2.5 py-1.5 text-xs font-bold text-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue disabled:opacity-50" @click="emit('change')">Cambiar</button>
          <p v-if="choiceError" role="alert" class="basis-full text-xs text-brand-error-text">{{ choiceError }}</p>
        </section>
</template>
