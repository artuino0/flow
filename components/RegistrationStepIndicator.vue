<script setup lang="ts">
import { Check } from '@lucide/vue'
defineProps<{ steps: string[]; currentStep: number }>()
</script>

<template>
  <div>
    <div class="mb-2 flex items-center gap-2" role="progressbar" :aria-label="`Paso ${currentStep} de ${steps.length}: ${steps[currentStep - 1] || ''}`" aria-valuemin="1" :aria-valuemax="steps.length" :aria-valuenow="currentStep">
      <template v-for="(label, index) in steps" :key="label">
        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold" :class="index + 1 < currentStep ? 'bg-brand-success-text text-brand-primary-fg' : index + 1 === currentStep ? 'bg-brand-orange text-brand-primary-fg' : 'border border-brand-control-border text-brand-sites-muted'" :aria-label="label">
          <Check v-if="index + 1 < currentStep" class="h-3.5 w-3.5" aria-hidden="true" :stroke-width="2.5" />
          <span v-else>{{ index + 1 }}</span>
        </div>
        <div v-if="index + 1 < steps.length" class="h-px flex-1" :class="index + 1 < currentStep ? 'bg-brand-orange' : 'bg-brand-border'" />
      </template>
    </div>
    <p class="text-xs font-semibold text-brand-sites-muted">Paso {{ currentStep }} de {{ steps.length }} · {{ steps[currentStep - 1] }}</p>
  </div>
</template>
