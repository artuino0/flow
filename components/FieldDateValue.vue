<script setup lang="ts">
import { exactFieldDate, relativeDate } from '~/utils/relativeDate'
import { formatDate } from '~/utils/fieldValueFormat'
import { computed } from 'vue'
const props = defineProps<{ value: unknown; rules?: Record<string, unknown>; timezone?: string; now?: Date }>()
const { user } = useAuth()
const loadedAt = new Date()
const zone = computed(() => props.timezone ?? user.value?.timezone ?? 'America/Mexico_City')
const empty = computed(() => props.value == null || props.value === '')
const exact = computed(() => empty.value ? '—' : exactFieldDate(String(props.value), zone.value))
const relative = computed(() => empty.value ? '—' : relativeDate(String(props.value), props.now ?? loadedAt, zone.value))
</script>

<template>
  <span v-if="empty">—</span>
  <span v-else-if="rules?.display === 'relative'" :title="exact" :aria-label="`${relative} (${exact})`">{{ relative }}</span>
  <span v-else-if="rules?.display === 'both'">{{ relative }} <span class="text-brand-text-muted">({{ exact }})</span></span>
  <span v-else>{{ formatDate(String(value)) }}</span>
</template>
