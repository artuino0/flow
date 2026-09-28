<script setup lang="ts">
import { onBeforeUnmount } from 'vue'

// Divisor arrastrable entre paneles. Extraído del editor de páginas de Sites (HU-ERD-109c):
// el arrastre usa pointer events (mouse + touch), el valor se emite con v-model y el padre
// decide cuándo persistir (evento commit). `measure` permite cálculos absolutos (ej. porcentajes).
const props = withDefaults(defineProps<{
  modelValue: number
  min: number
  max: number
  label: string
  defaultValue?: number
  step?: number
  direction?: 1 | -1
  measure?: (clientX: number, startValue: number) => number
  bordered?: boolean
  bodyClass?: string
}>(), { defaultValue: undefined, step: 8, direction: 1, bordered: false, bodyClass: 'panel-resizing' })

const emit = defineEmits<{ 'update:modelValue': [value: number]; commit: [] }>()

let stopDrag: (() => void) | null = null

function clamp(value: number) { return Math.min(props.max, Math.max(props.min, value)) }
function setValue(value: number) { emit('update:modelValue', clamp(value)) }

function onPointerDown(event: PointerEvent) {
  event.preventDefault()
  const startValue = props.modelValue
  const startX = event.clientX
  document.body.classList.add(props.bodyClass)
  const move = (moveEvent: PointerEvent) => {
    setValue(props.measure ? props.measure(moveEvent.clientX, startValue) : startValue + (moveEvent.clientX - startX) * props.direction)
  }
  const up = () => {
    document.body.classList.remove(props.bodyClass)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    stopDrag = null
    emit('commit')
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
  stopDrag = up
}

function onDblClick() {
  if (props.defaultValue === undefined) return
  setValue(props.defaultValue)
  emit('commit')
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  setValue(props.modelValue + (event.key === 'ArrowRight' ? props.step : -props.step) * props.direction)
  emit('commit')
}

onBeforeUnmount(() => { stopDrag?.() })
</script>

<template>
  <div class="panel-resize-handle" :class="{ 'is-bordered': bordered }" role="separator" aria-orientation="vertical" :aria-label="label" :aria-valuemin="min" :aria-valuemax="max" :aria-valuenow="Math.round(modelValue)" :tabindex="0" @pointerdown="onPointerDown" @dblclick="onDblClick" @keydown="onKeyDown"><span /></div>
</template>

<style scoped>
.panel-resize-handle { position: relative; z-index: 15; flex-shrink: 0; width: 5px; min-width: 5px; height: 100%; cursor: col-resize; background: #eef2f5; touch-action: none; }
.panel-resize-handle:hover, .panel-resize-handle:active { background: #d6edf1; }
.panel-resize-handle:focus-visible { background: #d6edf1; outline: none; box-shadow: inset 0 0 0 1px #0091ae; }
.panel-resize-handle span { position: absolute; top: 50%; left: 1px; width: 3px; height: 38px; transform: translateY(-50%); border-radius: 2px; background: #adc0cf; opacity: 0; }
.panel-resize-handle:hover span, .panel-resize-handle:active span { opacity: 1; }
.panel-resize-handle.is-bordered { border-right: 1px solid #d8e1e8; border-left: 1px solid #d8e1e8; }
:global(body.panel-resizing) { cursor: col-resize !important; user-select: none !important; }
:global(body.panel-resizing *) { cursor: col-resize !important; }
</style>
