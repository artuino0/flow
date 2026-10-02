<script setup lang="ts">
import { datePresentation, formattedFieldDate, relativeDate } from '~/utils/relativeDate'
import { formatDate } from '~/utils/fieldValueFormat'
import { computed } from 'vue'
const props = defineProps<{ value: unknown; rules?: Record<string, unknown>; timezone?: string; now?: Date }>()
const { user } = useAuth()
const loadedAt = new Date()
const zone = computed(() => props.timezone ?? user.value?.timezone ?? 'America/Mexico_City')
const empty = computed(() => props.value == null || props.value === '')
const presentation = computed(() => datePresentation(props.rules))
const exact = computed(() => empty.value ? '—' : formattedFieldDate(String(props.value), 'long', zone.value))
const relative = computed(() => empty.value ? '—' : relativeDate(String(props.value), props.now ?? loadedAt, zone.value))
// Sin metadata de presentación conserva literalmente el formateador anterior.
const visible = computed(() => props.rules?.dateFormat === undefined && props.rules?.showRelative === undefined && props.rules?.display === undefined
  ? formatDate(String(props.value)) : formattedFieldDate(String(props.value), presentation.value.dateFormat, zone.value))
const showRelative = computed(() => presentation.value.showRelative && exact.value !== 'Fecha inválida')
const accessible = computed(() => `${exact.value}${showRelative.value ? ` · ${relative.value}` : ''}`)
</script>

<template>
  <span v-if="empty">—</span>
  <span v-else :title="accessible" :aria-label="accessible">{{ visible }}<span v-if="showRelative" class="text-brand-text-secondary"> · {{ relative }}</span></span>
</template>
