<script setup lang="ts">
import { ChevronLeft, ChevronRight, Clock, Plus } from '@lucide/vue'
import type { CalendarConfig, EntityFieldMeta } from '~/composables/useEntityFields'
import { calendarBlockPosition, calendarRange, localDateKey, localDateTimeToIso, type CalendarView } from '~/utils/calendar'

interface CalendarEvent {
  id: string
  customData: Record<string, unknown>
  updatedAt: string
  date: string
  time: string
  durationMinutes: number
  title: string
  color: string | null
  groupValue: string
  groupLabel: string
}

const props = defineProps<{
  entitySlug: string
  entityName: string
  config: CalendarConfig
  fields: EntityFieldMeta[]
  events: CalendarEvent[]
  timezone: string
  pending?: boolean
  canUpdate: boolean
  assignedToMe: boolean
}>()

const emit = defineEmits<{
  'range-change': [range: { from: string; to: string }]
  'open-record': [id: string]
  'create-record': [payload: { date: string; time: string }]
  updated: [event: CalendarEvent]
}>()

const view = ref<CalendarView>(props.config.defaultView)
const anchor = ref(new Date())
const range = computed(() => calendarRange(anchor.value, view.value))
watch(range, value => emit('range-change', value), { immediate: true })
const dates = computed(() => {
  const start = new Date(`${range.value.from}T12:00:00`)
  if (view.value === 'day') return [start]
  if (view.value === 'week') return Array.from({ length: 7 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index, 12))
  const first = new Date(start.getFullYear(), start.getMonth(), 1, 12)
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7))
  return Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + index, 12))
})
const heading = computed(() => {
  const options: Intl.DateTimeFormatOptions = view.value === 'day' ? { dateStyle: 'full', timeZone: props.timezone } : { month: 'long', year: 'numeric', timeZone: props.timezone }
  return new Intl.DateTimeFormat('es-MX', options).format(anchor.value)
})
const timeRows = Array.from({ length: 15 }, (_, index) => index + 7)
const groups = computed(() => {
  if (!props.config.groupByField) return [{ value: '', label: '' }]
  const known = new Map<string, string>()
  for (const event of props.events) if (event.groupValue) known.set(event.groupValue, event.groupLabel || event.groupValue)
  if (props.events.some(event => !event.groupValue)) known.set('__unset__', 'Sin asignar')
  if (known.size === 0) known.set('__unset__', 'Sin registros')
  return [...known].map(([value, label]) => ({ value, label }))
})
const dragId = ref<string | null>(null)
const savingIds = ref(new Set<string>())
const skipNextClick = ref(false)
const toast = useToast()
const localEvent = (event: CalendarEvent, date: string, time: string, durationMinutes = event.durationMinutes, groupValue?: string) => {
  const changes: Record<string, unknown> = { [props.config.startDateField!]: date }
  if (props.config.startTimeField) {
    const field = props.fields.find(item => item.name === props.config.startTimeField)
    changes[props.config.startTimeField] = field?.dataType === 'datetime' ? localDateTimeToIso(date, time, props.timezone) : time
  }
  if (props.config.durationField) changes[props.config.durationField] = durationMinutes
  if (props.config.endField) {
    const [year, month, day] = date.split('-').map(Number)
    const [hour, minute] = time.split(':').map(Number)
    const end = new Date(Date.UTC(year, month - 1, day, hour, minute + durationMinutes))
    const endDate = end.toISOString().slice(0, 10)
    const endTime = `${String(end.getUTCHours()).padStart(2, '0')}:${String(end.getUTCMinutes()).padStart(2, '0')}`
    const field = props.fields.find(item => item.name === props.config.endField)
    changes[props.config.endField] = field?.dataType === 'datetime' ? localDateTimeToIso(endDate, endTime, props.timezone) : endTime
  }
  if (groupValue !== undefined && props.config.groupByField) changes[props.config.groupByField] = groupValue === '__unset__' ? null : groupValue
  return changes
}

async function persistMove(event: CalendarEvent, date: string, time: string, durationMinutes = event.durationMinutes, groupValue?: string) {
  if (!props.canUpdate || savingIds.value.has(event.id)) return
  savingIds.value = new Set(savingIds.value).add(event.id)
  try {
    const row = await $fetch<{ id: string; customData: Record<string, unknown>; updatedAt: string }>(`/api/records/${props.entitySlug}/${event.id}`, {
      method: 'PATCH',
      body: { changes: localEvent(event, date, time, durationMinutes, groupValue), expectedUpdatedAt: event.updatedAt }
    })
    emit('updated', { ...event, customData: row.customData, updatedAt: row.updatedAt, date, time, durationMinutes })
  } catch (error) {
    const message = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
    toast.error('No se pudo mover el registro', message || 'Revisa tus permisos e inténtalo de nuevo.')
  } finally {
    const next = new Set(savingIds.value)
    next.delete(event.id)
    savingIds.value = next
  }
}

function moveBy(amount: number) {
  const next = new Date(anchor.value)
  if (view.value === 'month') {
    const day = next.getDate()
    next.setDate(1)
    next.setMonth(next.getMonth() + amount)
    next.setDate(Math.min(day, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()))
  } else next.setDate(next.getDate() + amount * (view.value === 'week' ? 7 : 1))
  anchor.value = next
}
function cellTime(hour: number) { return `${String(hour).padStart(2, '0')}:00` }
function onDrop(date: Date, hour: number, groupValue: string) {
  const event = props.events.find(item => item.id === dragId.value)
  if (!event) return
  const nextGroup = view.value !== 'month' && props.config.groupByField && groupValue !== event.groupValue ? groupValue : undefined
  void persistMove(event, localDateKey(date), cellTime(hour), event.durationMinutes, nextGroup)
  skipNextClick.value = true
  setTimeout(() => { skipNextClick.value = false }, 180)
  dragId.value = null
}
function openEvent(id: string) {
  if (skipNextClick.value) return
  emit('open-record', id)
}
function createAt(date: Date, time = '09:00') {
  emit('create-record', { date: localDateKey(date), time })
}
function eventsFor(date: Date, groupValue = '') {
  const key = localDateKey(date)
  return props.events.filter(event => event.date === key && (!props.config.groupByField || event.groupValue === (groupValue === '__unset__' ? '' : groupValue)))
}
function blockStyle(event: CalendarEvent) {
  const position = calendarBlockPosition(event.time, event.durationMinutes)
  return { top: `${position.top}px`, height: `${position.height}px`, borderLeftColor: event.color ?? 'var(--color-brand-blue, #0091ae)' }
}
</script>

<template>
  <section class="calendar-shell">
    <header class="calendar-head">
      <div class="flex items-center gap-2">
        <button type="button" class="calendar-icon-button" aria-label="Periodo anterior" @click="moveBy(-1)"><ChevronLeft class="h-4 w-4" /></button>
        <button type="button" class="calendar-today" @click="anchor = new Date()">Hoy</button>
        <button type="button" class="calendar-icon-button" aria-label="Periodo siguiente" @click="moveBy(1)"><ChevronRight class="h-4 w-4" /></button>
        <h2 class="calendar-heading">{{ heading }}</h2>
      </div>
      <div class="calendar-head-actions">
        <span v-if="assignedToMe" class="calendar-filter-tag">Asignado a mí</span>
        <div class="calendar-views" aria-label="Periodo del calendario">
          <button v-for="option in (['day', 'week', 'month'] as const)" :key="option" type="button" :class="{ active: view === option }" @click="view = option">{{ option === 'day' ? 'Día' : option === 'week' ? 'Semana' : 'Mes' }}</button>
        </div>
      </div>
    </header>

    <p v-if="pending" class="calendar-message">Cargando eventos…</p>
    <div v-else-if="view === 'month'" class="calendar-month">
      <div class="calendar-weekdays"><span v-for="day in ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']" :key="day">{{ day }}</span></div>
      <div class="calendar-month-grid">
        <section v-for="date in dates" :key="localDateKey(date)" class="calendar-month-cell" :class="{ muted: date.getMonth() !== anchor.getMonth() }" @dragover.prevent @drop.prevent="onDrop(date, 9, '')">
          <button type="button" class="calendar-date" @click="createAt(date)">{{ date.getDate() }}</button>
          <button v-for="event in eventsFor(date).slice(0, 3)" :key="event.id" type="button" class="calendar-month-event" :style="{ borderLeftColor: event.color ?? '#0091ae' }" :draggable="canUpdate" @dragstart="dragId = event.id" @click="openEvent(event.id)">{{ event.title }} <span v-if="event.time">{{ event.time }}</span></button>
          <button v-if="eventsFor(date).length > 3" type="button" class="calendar-more" @click="anchor = date; view = 'day'">+{{ eventsFor(date).length - 3 }} más</button>
          <button type="button" class="calendar-add" :aria-label="`Crear registro el ${localDateKey(date)}`" @click="createAt(date)"><Plus class="h-3.5 w-3.5" /></button>
        </section>
      </div>
    </div>

    <div v-else class="calendar-time-view">
      <div class="calendar-time-heading" :style="view === 'day' ? { gridTemplateColumns: `56px repeat(${config.groupByField ? groups.length : 1}, minmax(220px, 1fr))` } : undefined">
        <div class="calendar-time-spacer" />
        <template v-if="view === 'day' && config.groupByField"><div v-for="group in groups" :key="group.value" class="calendar-day-heading"><span>{{ group.label }}</span><strong>{{ dates[0].getDate() }}</strong></div></template>
        <div v-else v-for="date in dates" :key="localDateKey(date)" class="calendar-day-heading"><span>{{ new Intl.DateTimeFormat('es-MX', { weekday: 'short', timeZone: timezone }).format(date) }}</span><strong>{{ date.getDate() }}</strong></div>
      </div>
      <div v-for="group in (config.groupByField && view !== 'day' ? groups : [{ value: '__all__', label: '' }])" :key="group.value" class="calendar-group">
        <h3 v-if="config.groupByField && view !== 'day'" class="calendar-group-title">{{ group.label }}</h3>
        <div v-if="view === 'day' && config.groupByField" class="calendar-time-grid calendar-resource-grid" :style="{ gridTemplateColumns: `56px repeat(${groups.length}, minmax(220px, 1fr))` }">
          <div class="calendar-hours"><span v-for="hour in timeRows" :key="hour">{{ `${String(hour).padStart(2, '0')}:00` }}</span></div>
          <div v-for="resource in groups" :key="resource.value" class="calendar-day-column">
            <h4 class="calendar-resource-heading">{{ resource.label }}</h4>
            <div v-for="hour in timeRows" :key="hour" class="calendar-time-slot" @dragover.prevent @drop.prevent="onDrop(dates[0], hour, resource.value)"><button type="button" :aria-label="`Crear registro con ${resource.label} a las ${cellTime(hour)}`" @click="createAt(dates[0], cellTime(hour))" /></div>
            <article v-for="event in eventsFor(dates[0], resource.value)" :key="event.id" class="calendar-event" :class="{ saving: savingIds.has(event.id) }" :style="blockStyle(event)" :draggable="canUpdate" @dragstart="dragId = event.id" @click="openEvent(event.id)">
              <strong>{{ event.title }}</strong><span v-if="event.time"><Clock class="inline h-3 w-3" /> {{ event.time }}</span>
              <div v-if="canUpdate && (config.durationField || config.endField)" class="calendar-duration-actions" @click.stop><button type="button" aria-label="Reducir duración 15 minutos" @click="persistMove(event, event.date, event.time || '09:00', Math.max(15, event.durationMinutes - 15))">−15</button><button type="button" aria-label="Aumentar duración 15 minutos" @click="persistMove(event, event.date, event.time || '09:00', event.durationMinutes + 15)">+15</button></div>
            </article>
          </div>
        </div>
        <div v-else class="calendar-time-grid" :class="{ 'calendar-single-day': view === 'day' }">
          <div class="calendar-hours"><span v-for="hour in timeRows" :key="hour">{{ `${String(hour).padStart(2, '0')}:00` }}</span></div>
          <div v-for="date in dates" :key="localDateKey(date)" class="calendar-day-column">
            <div v-for="hour in timeRows" :key="hour" class="calendar-time-slot" @dragover.prevent @drop.prevent="onDrop(date, hour, group.value)"><button type="button" :aria-label="`Crear registro a las ${cellTime(hour)}`" @click="createAt(date, cellTime(hour))" /></div>
            <article v-for="event in eventsFor(date, group.value)" :key="event.id" class="calendar-event" :class="{ saving: savingIds.has(event.id) }" :style="blockStyle(event)" :draggable="canUpdate" @dragstart="dragId = event.id" @click="openEvent(event.id)">
              <strong>{{ event.title }}</strong><span v-if="event.time"><Clock class="inline h-3 w-3" /> {{ event.time }}</span>
              <div v-if="canUpdate && (config.durationField || config.endField)" class="calendar-duration-actions" @click.stop><button type="button" aria-label="Reducir duración 15 minutos" @click="persistMove(event, event.date, event.time || '09:00', Math.max(15, event.durationMinutes - 15))">−15</button><button type="button" aria-label="Aumentar duración 15 minutos" @click="persistMove(event, event.date, event.time || '09:00', event.durationMinutes + 15)">+15</button></div>
            </article>
          </div>
        </div>
      </div>
    </div>

    <div class="calendar-mobile-list">
      <section v-for="date in dates" :key="localDateKey(date)" class="calendar-mobile-day">
        <header><strong>{{ new Intl.DateTimeFormat('es-MX', { dateStyle: 'full', timeZone: timezone }).format(date) }}</strong><button type="button" @click="createAt(date)"><Plus class="h-4 w-4" /> Crear</button></header>
        <button v-for="event in eventsFor(date)" :key="event.id" type="button" class="calendar-mobile-event" @click="openEvent(event.id)"><span class="calendar-mobile-dot" :style="{ backgroundColor: event.color ?? '#0091ae' }" /><span class="min-w-0 flex-1"><strong>{{ event.title }}</strong><small>{{ event.time || 'Todo el día' }}<template v-if="event.groupLabel"> · {{ event.groupLabel }}</template></small></span><ChevronRight class="h-4 w-4" /></button>
        <p v-if="eventsFor(date).length === 0" class="calendar-empty-day">Sin eventos</p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.calendar-shell{--brand-bg:#f5f8fa;--brand-surface:#fff;--brand-border:#cbd6e2;--brand-border-light:#e5eaf0;--brand-text:#33475b;--brand-text-secondary:#516f90;--brand-text-muted:#8da1b5;--brand-blue:#0091ae;--brand-blue-soft:#eaf3f6;display:flex;min-width:0;flex-direction:column;overflow:hidden;border:1px solid var(--brand-border);border-radius:8px;background:var(--brand-surface);color:var(--brand-text)}
:global(.dark) .calendar-shell{color-scheme:dark;--brand-bg:#13212b;--brand-surface:#192b38;--brand-border:#385060;--brand-border-light:#293e4d;--brand-text:#e6edf2;--brand-text-secondary:#b1c4d1;--brand-text-muted:#849baa;--brand-blue:#35b9cf;--brand-blue-soft:#1d3c49}
.calendar-head{display:flex;min-height:60px;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--brand-border-light,#edf0f4);padding:10px 14px}
.calendar-head>div,.calendar-head-actions{display:flex;align-items:center;gap:8px}.calendar-heading{margin:0 0 0 8px;font-size:15px;font-weight:700;text-transform:capitalize}
.calendar-icon-button,.calendar-today{display:inline-flex;height:32px;align-items:center;justify-content:center;border:1px solid var(--brand-border,#d7e0e8);border-radius:5px;background:var(--brand-surface,#fff);padding:0 9px;color:var(--brand-text-secondary,#516f90)}.calendar-icon-button{width:32px;padding:0}.calendar-today{font-size:12px;font-weight:650}.calendar-icon-button:hover,.calendar-today:hover{background:var(--brand-bg,#f5f8fa)}
.calendar-views{display:flex;gap:2px;border-radius:5px;background:var(--brand-bg,#f5f8fa);padding:3px}.calendar-views button{border-radius:4px;padding:5px 10px;font-size:12px;font-weight:600;color:var(--brand-text-secondary,#516f90)}.calendar-views button.active{background:var(--brand-surface,#fff);color:var(--brand-blue,#0091ae);box-shadow:0 1px 3px #33475b18}.calendar-filter-tag{border-radius:99px;background:var(--brand-blue-soft,#eaf3f6);padding:5px 9px;font-size:11px;font-weight:650;color:var(--brand-blue,#0091ae)}
.calendar-message{padding:24px;color:var(--brand-text-muted,#8da1b5);font-size:13px}.calendar-month{min-width:760px}.calendar-weekdays{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));border-bottom:1px solid var(--brand-border-light,#edf0f4)}.calendar-weekdays span{padding:10px;text-align:center;font-size:11px;font-weight:700;text-transform:uppercase;color:var(--brand-text-muted,#8da1b5)}.calendar-month-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}.calendar-month-cell{position:relative;min-height:106px;border-right:1px solid var(--brand-border-light,#edf0f4);border-bottom:1px solid var(--brand-border-light,#edf0f4);padding:6px}.calendar-month-cell.muted{background:var(--brand-bg,#f8fafb)}.calendar-date{display:grid;height:25px;width:25px;place-items:center;border-radius:50%;font-size:12px;font-weight:650}.calendar-month-cell:not(.muted) .calendar-date{color:var(--brand-text,#33475b)}.calendar-date:hover{background:var(--brand-blue-soft,#eaf3f6)}.calendar-month-event{display:block;width:100%;overflow:hidden;border-left:3px solid;border-radius:3px;margin-top:3px;background:var(--brand-bg,#f5f8fa);padding:3px 5px;text-align:left;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:600}.calendar-month-event span{margin-left:4px;font-size:9px;font-weight:500;color:var(--brand-text-muted,#8da1b5)}.calendar-more{padding:3px 5px;font-size:10px;color:var(--brand-blue,#0091ae)}.calendar-add{position:absolute;right:5px;top:6px;display:none;align-items:center;justify-content:center;border-radius:4px;padding:3px;color:var(--brand-text-secondary,#516f90)}.calendar-month-cell:hover .calendar-add{display:flex}
.calendar-time-view{overflow:auto}.calendar-time-heading{position:sticky;top:0;z-index:3;display:grid;grid-template-columns:56px repeat(7,minmax(120px,1fr));min-width:896px;border-bottom:1px solid var(--brand-border-light,#edf0f4);background:var(--brand-surface,#fff)}.calendar-time-spacer{grid-column:1}.calendar-day-heading{display:flex;align-items:center;justify-content:center;gap:6px;padding:9px;font-size:12px;text-transform:capitalize;color:var(--brand-text-secondary,#516f90)}.calendar-day-heading strong{display:grid;height:26px;width:26px;place-items:center;border-radius:50%;background:var(--brand-bg,#f5f8fa);font-size:12px;color:var(--brand-text,#33475b)}.calendar-time-grid{display:grid;grid-template-columns:56px repeat(7,minmax(120px,1fr));min-width:896px;position:relative}.calendar-time-grid.calendar-single-day{grid-template-columns:56px minmax(250px,1fr)}.calendar-hours{display:grid;grid-template-rows:repeat(15,64px)}.calendar-hours span{position:relative;top:-7px;padding-right:9px;text-align:right;font-size:10px;color:var(--brand-text-muted,#8da1b5)}.calendar-day-column{position:relative;min-height:960px;border-left:1px solid var(--brand-border-light,#edf0f4)}.calendar-time-slot{height:64px;border-bottom:1px solid var(--brand-border-light,#edf0f4)}.calendar-time-slot button{display:block;height:100%;width:100%;cursor:pointer}.calendar-time-slot:hover{background:var(--brand-blue-soft,#eaf3f6)}.calendar-event{position:absolute;z-index:1;right:3px;left:3px;display:flex;overflow:hidden;flex-direction:column;gap:3px;border-left:3px solid;border-radius:4px;background:var(--brand-blue-soft,#eaf3f6);padding:5px 6px;cursor:pointer;box-shadow:0 1px 3px #33475b15}.calendar-event strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:1.3}.calendar-event>span{font-size:10px;color:var(--brand-text-secondary,#516f90)}.calendar-event.saving{opacity:.55}.calendar-duration-actions{display:flex;gap:4px}.calendar-duration-actions button{border-radius:3px;background:#ffffffb8;padding:1px 4px;font-size:9px;color:var(--brand-text-secondary,#516f90)}.calendar-group+.calendar-group{border-top:1px solid var(--brand-border,#e5eaf0)}.calendar-group-title{position:sticky;left:0;z-index:2;margin:0;background:var(--brand-bg,#f5f8fa);padding:6px 12px;font-size:11px;font-weight:700;color:var(--brand-text-secondary,#516f90)}
.calendar-resource-grid{min-width:max-content}.calendar-resource-heading{position:sticky;top:0;z-index:2;height:38px;margin:0;background:var(--brand-surface,#fff);padding:10px;text-align:center;font-size:11px;font-weight:700;color:var(--brand-text-secondary,#516f90)}
.calendar-mobile-list{display:none}
@media(max-width:720px){.calendar-head{align-items:flex-start;flex-direction:column}.calendar-head-actions{width:100%;justify-content:space-between}.calendar-time-view,.calendar-month{display:none}.calendar-mobile-list{display:flex;flex-direction:column}.calendar-mobile-day{padding:12px 14px;border-bottom:1px solid var(--brand-border-light,#edf0f4)}.calendar-mobile-day>header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;text-transform:capitalize}.calendar-mobile-day>header strong{font-size:12px}.calendar-mobile-day>header button{display:flex;align-items:center;gap:4px;color:var(--brand-blue,#0091ae);font-size:11px;font-weight:650}.calendar-mobile-event{display:flex;width:100%;align-items:center;gap:9px;border-radius:5px;padding:9px 5px;text-align:left}.calendar-mobile-event:hover{background:var(--brand-bg,#f5f8fa)}.calendar-mobile-event>span:nth-child(2){display:flex;flex-direction:column;gap:3px}.calendar-mobile-event strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.calendar-mobile-event small{font-size:10px;color:var(--brand-text-muted,#8da1b5)}.calendar-mobile-dot{height:8px;width:8px;flex:none;border-radius:50%}.calendar-empty-day{padding:8px 5px;font-size:11px;color:var(--brand-text-muted,#8da1b5)}}
</style>
