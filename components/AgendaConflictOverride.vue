<script setup lang="ts">
defineProps<{ modelValue: string; disabled?: boolean }>()
defineEmits<{ 'update:modelValue': [string] }>()
const { data: isAdmin } = await useIsAdmin()
const open = ref(true)
</script>
<template>
  <section v-if="isAdmin" class="agenda-ui mt-4" data-dark-ready="true">
    <button v-if="!open" type="button" class="settings-button" @click="open = true">Revisar choque de citas</button>
    <AgendaInternalModal v-if="open" title="Choque de citas" :busy="disabled" @close="open = false; $emit('update:modelValue', '')">
    <h3 class="text-sm font-semibold text-brand-warning-text">El hueco está ocupado</h3>
    <p class="mt-1 text-sm text-brand-text">Como administrador puedes forzar el traslape. El motivo quedará en la actividad de la cita.</p>
    <label class="settings-field mt-3">Motivo de la excepción<textarea :value="modelValue" :disabled="disabled" minlength="5" maxlength="500" rows="2" @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" /></label>
    <p class="mt-2 text-xs text-brand-text-muted">Escribe al menos cinco caracteres y vuelve a guardar para forzar.</p>
    <template #footer><footer class="agenda-action-bar"><span>La excepción quedará registrada.</span><div><button type="button" class="settings-button" :disabled="disabled" @click="open = false; $emit('update:modelValue', '')">Cancelar</button><button type="button" class="settings-button agenda-primary" :disabled="disabled || modelValue.trim().length < 5" @click="open = false">Confirmar motivo</button></div></footer></template>
    </AgendaInternalModal>
  </section>
</template>
