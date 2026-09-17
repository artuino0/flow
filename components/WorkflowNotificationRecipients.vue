<script setup lang="ts">
interface Recipient {
  type: 'user' | 'role'
  id: string
  label: string
}

interface RecipientOptions {
  users: Array<{ id: string; label: string; email?: string | null }>
  roles: Array<{ id: string; name: string }>
}

const props = defineProps<{ modelValue: Recipient[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: Recipient[]] }>()

const root = ref<HTMLElement>()
const input = ref<HTMLInputElement>()
const open = ref(false)
const query = ref('')
const inputValue = ref('')
const mode = ref<'user' | 'role'>('user')
const highlighted = ref(0)
const loading = ref(false)
const loaded = ref(false)
const users = ref<RecipientOptions['users']>([])
const roles = ref<RecipientOptions['roles']>([])

const options = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  if (mode.value === 'role') {
    return roles.value
      .filter(role => !needle || role.name.toLocaleLowerCase().includes(needle))
      .map(role => ({ type: 'role' as const, id: role.id, label: role.name, detail: 'Notificar a todos los usuarios con este rol' }))
  }
  return users.value
    .filter(user => !needle || user.label.toLocaleLowerCase().includes(needle) || String(user.email ?? '').toLocaleLowerCase().includes(needle))
    .map(user => ({ type: 'user' as const, id: user.id, label: user.label, detail: user.email || 'Usuario activo' }))
})

async function loadOptions() {
  if (loaded.value || loading.value) return
  loading.value = true
  try {
    const response = await $fetch<RecipientOptions>('/api/notifications/recipients')
    users.value = response.users ?? []
    roles.value = response.roles ?? []
    loaded.value = true
  } catch {
    users.value = []
    roles.value = []
  } finally {
    loading.value = false
  }
}

function show(modeValue: 'user' | 'role' = mode.value) {
  mode.value = modeValue
  highlighted.value = 0
  open.value = true
  void loadOptions()
}

function parseQuery(value: string) {
  inputValue.value = value
  if (value.startsWith('@')) {
    mode.value = 'user'
    query.value = value.slice(1)
  } else if (value.startsWith('&')) {
    mode.value = 'role'
    query.value = value.slice(1)
  } else {
    mode.value = 'user'
    query.value = value
  }
  highlighted.value = 0
  open.value = true
  void loadOptions()
}

function add(option: { type: 'user' | 'role'; id: string; label: string }) {
  if (!props.modelValue.some(item => item.type === option.type && item.id === option.id)) {
    emit('update:modelValue', [...props.modelValue, { type: option.type, id: option.id, label: option.label }])
  }
  query.value = ''
  inputValue.value = ''
  mode.value = 'user'
  open.value = false
  nextTick(() => input.value?.focus())
}

function remove(recipient: Recipient) {
  emit('update:modelValue', props.modelValue.filter(item => !(item.type === recipient.type && item.id === recipient.id)))
  nextTick(() => input.value?.focus())
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    open.value = false
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!open.value) show()
    event.preventDefault()
    const delta = event.key === 'ArrowDown' ? 1 : -1
    highlighted.value = Math.max(0, Math.min(Math.max(0, options.value.length - 1), highlighted.value + delta))
    return
  }
  if (event.key === 'Enter' && open.value && options.value[highlighted.value]) {
    event.preventDefault()
    add(options.value[highlighted.value]!)
  }
}

function onDocumentPointer(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointer))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointer))
</script>

<template>
  <div ref="root" class="recipient-picker">
    <div class="recipient-control" :class="{ focused: open }" @click="show()">
      <span v-for="recipient in modelValue" :key="`${recipient.type}:${recipient.id}`" class="recipient-pill" :class="recipient.type">
        <span class="pill-prefix">{{ recipient.type === 'user' ? '@' : '&' }}</span>{{ recipient.label }}
        <button type="button" :aria-label="`Quitar ${recipient.label}`" @click.stop="remove(recipient)">×</button>
      </span>
      <input
        ref="input"
        :value="inputValue"
        placeholder="Escribe un nombre, @usuario o &amp;rol…"
        aria-label="Destinatarios de la notificación"
        @focus="show()"
        @input="parseQuery(($event.target as HTMLInputElement).value)"
        @keydown="onKeydown"
      />
    </div>
    <div v-if="open" class="recipient-menu" role="listbox" aria-label="Destinatarios disponibles">
      <div class="recipient-menu-heading">
        <span><strong>{{ mode === 'role' ? 'Roles' : 'Usuarios' }}</strong><small>{{ mode === 'role' ? 'Escribe & para buscar un rol' : 'Escribe @ para buscar un usuario' }}</small></span>
        <button type="button" aria-label="Cerrar destinatarios" @click="open = false">×</button>
      </div>
      <p v-if="loading" class="recipient-state">Cargando destinatarios…</p>
      <template v-else>
        <button
          v-for="(option, index) in options"
          :key="`${option.type}:${option.id}`"
          type="button"
          role="option"
          :aria-selected="highlighted === index"
          class="recipient-option"
          @mousedown.prevent
          @click="add(option)"
        >
          <span class="option-avatar">{{ option.type === 'role' ? '&' : '@' }}</span>
          <span><strong>{{ option.label }}</strong><small>{{ option.detail }}</small></span>
        </button>
        <p v-if="!options.length" class="recipient-state">No hay {{ mode === 'role' ? 'roles' : 'usuarios' }} disponibles.</p>
      </template>
      <small class="recipient-help">Selecciona un resultado para convertirlo en píldora.</small>
    </div>
  </div>
</template>

<style scoped>
.recipient-picker{position:relative;width:100%}
.recipient-control{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-height:40px;padding:5px 9px;border:1px solid #cbd6e2;border-radius:4px;background:#fff;cursor:text}.recipient-control.focused{border-color:#0091ae;box-shadow:0 0 0 1px #0091ae}.recipient-control input{flex:1;min-width:155px;height:28px;padding:3px 2px;border:0;outline:0;background:transparent;color:#33475b;font:inherit}.recipient-control input::placeholder{color:#8da1b5}
.recipient-pill{display:inline-flex;align-items:center;gap:2px;max-width:100%;padding:4px 6px 4px 8px;border-radius:999px;background:#eaf3f6;color:#006f86;font-size:12px;line-height:18px}.recipient-pill.role{background:#ede7fb;color:#6534b0}.recipient-pill button{display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;margin-left:2px;border-radius:50%;color:inherit;font-size:15px;line-height:15px}.recipient-pill button:hover{background:#ffffff80}.pill-prefix{font-weight:700}
.recipient-menu{position:absolute;top:calc(100% + 6px);left:0;right:0;z-index:30;overflow:hidden;border:1px solid #cbd6e2;border-radius:7px;background:#fff;box-shadow:0 8px 24px #33475b26}.recipient-menu-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:11px 12px;border-bottom:1px solid #e5eaf0}.recipient-menu-heading span{display:flex;flex-direction:column;gap:2px}.recipient-menu-heading strong{font-size:12px;color:#33475b}.recipient-menu-heading small,.recipient-option small,.recipient-help{font-size:11px;color:#8da1b5}.recipient-menu-heading button{padding:0 3px;color:#8da1b5;font-size:20px;line-height:18px}.recipient-option{display:flex;align-items:center;width:100%;gap:9px;padding:9px 12px;text-align:left}.recipient-option:hover,.recipient-option[aria-selected=true]{background:#eaf3f6}.recipient-option>span:last-child{display:flex;flex-direction:column;gap:2px;min-width:0}.recipient-option strong{font-size:12px;color:#33475b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.option-avatar{display:flex;align-items:center;justify-content:center;width:26px;height:26px;flex:0 0 26px;border-radius:50%;background:#eaf3f6;color:#0091ae;font-weight:700}.recipient-option .option-avatar{background:#ede7fb;color:#6d3fc4}.recipient-state{padding:15px 12px;color:#8da1b5;font-size:12px}.recipient-help{display:block;padding:9px 12px;border-top:1px solid #e5eaf0}
</style>
