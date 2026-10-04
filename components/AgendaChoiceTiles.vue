<script setup lang="ts">
import { Building2, Shuffle, UserRound, Users } from '@lucide/vue'
const props = defineProps<{ label: string; options: Array<{ value: string; label: string; description?: string }>; modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()
const name = useId()
const icons = { client_chooses: UserRound, auto: Shuffle, both: Users, inherit: Building2 }
function keyboard(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const current = props.options.findIndex(option => option.value === props.modelValue)
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? props.options.length - 1 : (current + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + props.options.length) % props.options.length
  emit('update:modelValue', props.options[index]!.value)
  const group = event.currentTarget as HTMLElement
  nextTick(() => group.querySelectorAll<HTMLInputElement>('input')[index]?.focus())
}
</script>
<template>
  <fieldset class="agenda-choice-group" @keydown="keyboard"><legend>{{ label }}</legend><div class="agenda-choice-tiles"><label v-for="option in options" :key="option.value" class="agenda-choice" :class="{ selected: modelValue === option.value }"><input type="radio" :name="name" :value="option.value" :checked="modelValue === option.value" :tabindex="modelValue === option.value ? 0 : -1" @change="emit('update:modelValue', option.value)" /><span><component :is="icons[option.value as keyof typeof icons]" v-if="option.value in icons" :size="16" aria-hidden="true" class="text-brand-blue" /><slot :option="option" /><strong>{{ option.label }}</strong><span v-if="option.description" class="agenda-note">{{ option.description }}</span></span></label></div></fieldset>
</template>
