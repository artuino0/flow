<script setup lang="ts">
defineProps<{ title: string; confirmLabel: string; cancelLabel?: string; busy?: boolean; destructive?: boolean }>()
const emit = defineEmits<{ cancel: []; confirm: [] }>()
const dialog = ref<HTMLDialogElement>()
onMounted(() => dialog.value?.showModal())
onBeforeUnmount(() => dialog.value?.close())
</script>
<template>
  <dialog ref="dialog" aria-labelledby="settings-dialog-title" class="w-[calc(100%-32px)] max-w-md rounded-lg border-0 bg-white p-6 text-brand-text shadow-xl backdrop:bg-black/40" @cancel.prevent="emit('cancel')">
    <h2 id="settings-dialog-title" class="text-base font-bold">{{ title }}</h2>
    <div class="mt-3 text-sm text-brand-text-secondary"><slot /></div>
    <div class="mt-6 flex justify-end gap-3">
      <button autofocus :disabled="busy" class="rounded border border-brand-border px-4 py-2 text-sm font-semibold" @click="emit('cancel')">{{ cancelLabel || 'Cancelar' }}</button>
      <button :disabled="busy" class="rounded px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" :class="destructive ? 'bg-brand-error-text' : 'bg-brand-orange'" @click="emit('confirm')">{{ busy ? 'Procesando…' : confirmLabel }}</button>
    </div>
  </dialog>
</template>
