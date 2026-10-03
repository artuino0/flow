<script setup lang="ts">
defineProps<{ modelValue: string; disabled?: boolean }>()
defineEmits<{ 'update:modelValue': [string] }>()
const { data: isAdmin } = await useIsAdmin()
</script>
<template>
  <section v-if="isAdmin" class="agenda-ui mt-4 rounded border border-brand-border-light bg-brand-warning-bg p-4" data-dark-ready="true">
    <h3 class="text-sm font-semibold text-brand-warning-text">El hueco está ocupado</h3>
    <p class="mt-1 text-sm text-brand-text">Como administrador puedes forzar el traslape. El motivo quedará en la actividad de la cita.</p>
    <label class="settings-field mt-3">Motivo de la excepción<textarea :value="modelValue" :disabled="disabled" minlength="5" maxlength="500" rows="2" @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" /></label>
    <p class="mt-2 text-xs text-brand-text-muted">Escribe al menos cinco caracteres y vuelve a guardar para forzar.</p>
  </section>
</template>
