<script setup lang="ts">
import type { AgendaSchedule } from '~/utils/agenda'
const props = defineProps<{ schedules: AgendaSchedule[] }>()
const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const totals = computed(() => [1, 2, 3, 4, 5, 6, 0].map(weekday => props.schedules.filter(row => row.weekday === weekday).reduce((sum, row) => {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  return sum + Math.max(0, minutes(row.endTime) - minutes(row.startTime)) / 60
}, 0)))
const hours = computed(() => totals.value.reduce((sum, value) => sum + value, 0))
const working = computed(() => totals.value.filter(value => value > 0).length)
const number = (value: number) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(value)
</script>
<template>
  <AgendaCard title="Resumen semanal" description="Horario de atención configurado">
    <p class="agenda-summary-total"><strong>{{ number(hours) }} h</strong> por semana</p>
    <p>{{ working }} días de atención · {{ 7 - working }} días sin atención</p>
    <ul class="agenda-summary-days"><li v-for="(day, index) in days" :key="day"><span>{{ day }}</span><span class="agenda-summary-track" aria-hidden="true"><span :style="{ width: `${totals[index]! / Math.max(...totals, 1) * 100}%` }" /></span><span>{{ totals[index] ? `${number(totals[index]!)} h` : 'Sin atención' }}</span></li></ul>
    <p class="agenda-note">Las horas se suman por día. Las vigencias limitan las fechas en las que se ofrecen citas.</p>
  </AgendaCard>
</template>
