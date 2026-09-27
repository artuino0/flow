<script setup lang="ts">
import { formatCentsToCurrency, formatCurrencyDraft, parseCurrencyToCents } from '~/utils/currencyInput'

const props = defineProps<{ modelValue: number | null }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: number | null): void }>()

const text = ref(props.modelValue == null ? '' : formatCentsToCurrency(props.modelValue))
const focused = ref(false)

watch(() => props.modelValue, value => {
  if (focused.value) return
  text.value = value == null ? '' : formatCentsToCurrency(value)
})

function countDigits(value: string, end: number) {
  let count = 0
  for (let i = 0; i < end && i < value.length; i++) if (value[i]! >= '0' && value[i]! <= '9') count++
  return count
}

function caretForDigitCount(value: string, count: number) {
  let seen = 0
  for (let i = 0; i < value.length; i++) {
    if (value[i]! >= '0' && value[i]! <= '9') {
      if (seen === count) return i
      seen++
    }
  }
  return value.length
}

function onInput(event: Event) {
  const el = event.target as HTMLInputElement
  const digits = countDigits(el.value, el.selectionStart ?? el.value.length)
  const formatted = formatCurrencyDraft(el.value)
  text.value = formatted
  emit('update:modelValue', parseCurrencyToCents(formatted))
  nextTick(() => {
    if (el.value !== formatted) el.value = formatted
    const caret = caretForDigitCount(formatted, digits)
    el.setSelectionRange(caret, caret)
  })
}

function onBlur() {
  focused.value = false
  const cents = parseCurrencyToCents(text.value)
  text.value = cents == null ? '' : formatCentsToCurrency(cents)
}
</script>

<template>
  <input :value="text" type="text" inputmode="decimal" autocomplete="off" @input="onInput" @focus="focused = true" @blur="onBlur" />
</template>
