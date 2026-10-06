<script setup lang="ts">
import { Check } from '@lucide/vue'
defineProps<{ steps: string[]; currentStep: number }>()
</script>

<template>
  <div>
    <div class="mb-2 flex items-center gap-2" role="progressbar" :aria-label="`Paso ${currentStep} de ${steps.length}: ${steps[currentStep - 1] || ''}`" aria-valuemin="1" :aria-valuemax="steps.length" :aria-valuenow="currentStep">
      <template v-for="(label, index) in steps" :key="label">
        <div class="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-xs font-semibold" :class="index + 1 <= currentStep ? 'bg-brand-orange text-brand-primary-fg' : 'border border-brand-control-border text-brand-sites-muted'" :aria-label="label">
          <Check v-if="index + 1 < currentStep || currentStep === steps.length" class="h-[13px] w-[13px]" aria-hidden="true" :stroke-width="2.5" />
          <span v-else>{{ index + 1 }}</span>
        </div>
        <div v-if="index + 1 < steps.length" class="h-px flex-1" :class="index + 1 < currentStep ? 'bg-brand-orange' : 'bg-brand-border'" />
      </template>
    </div>
    <p class="text-xs font-semibold text-brand-sites-muted">Paso {{ currentStep }} de {{ steps.length }}</p>
  </div>
</template>
