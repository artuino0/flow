<script setup lang="ts">
import type { EntityFieldMeta } from '~/composables/useEntityFields'

type UserOption = { id: string; fullName: string | null; email: string; isActive: boolean; roleId: string | null; roleName: string | null }
const props = defineProps<{ field: EntityFieldMeta; modelValue: unknown; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string | string[] | null] }>()
const route = useRoute()
const search = ref('')
const users = ref<UserOption[]>([])
const multiple = computed(() => props.field.validationRules?.multiple === true)
const selected = computed(() => Array.isArray(props.modelValue) ? props.modelValue.filter((id): id is string => typeof id === 'string') : typeof props.modelValue === 'string' ? [props.modelValue] : [])
const roles = computed(() => Array.isArray(props.field.validationRules?.roles) ? props.field.validationRules.roles as string[] : [])
const available = computed(() => users.value.filter(user => user.isActive && (!roles.value.length || roles.value.includes(user.roleId ?? '') || roles.value.includes(user.roleName ?? '')) && `${user.fullName ?? ''} ${user.email}`.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())))
function label(id: string): string {
  const user = users.value.find(row => row.id === id)
  return user ? `${user.fullName || user.email}${user.isActive ? '' : ' (inactivo)'}` : `${id} (inactivo)`
}
function choose(id: string) {
  emit('update:modelValue', multiple.value ? [...new Set([...selected.value, id])] : id)
  search.value = ''
}
function remove(id: string) {
  const remaining = selected.value.filter(value => value !== id)
  emit('update:modelValue', multiple.value ? remaining : null)
}
onMounted(async () => {
  const [lookup, me] = await Promise.all([$fetch<{ users: UserOption[] }>('/api/users/lookup'), $fetch<{ id: string }>('/api/auth/me')])
  users.value = lookup.users
  if (route.path.endsWith('/nuevo') && props.field.validationRules?.defaultCurrentUser === true && !selected.value.length && available.value.some(user => user.id === me.id)) choose(me.id)
})
</script>

<template>
  <div class="space-y-2">
    <div v-if="selected.length" class="flex flex-wrap gap-1.5">
      <span v-for="id in selected" :key="id" class="inline-flex items-center gap-2 rounded-full bg-brand-blue-bg px-2.5 py-1 text-xs text-brand-text">
        <span class="flex h-5 w-5 items-center justify-center rounded-full bg-brand-blue text-[9px] font-bold text-brand-accent-fg">{{ label(id).slice(0, 2).toUpperCase() }}</span>
        {{ label(id) }}
        <button v-if="!disabled" type="button" :aria-label="`Quitar ${label(id)}`" @click="remove(id)">×</button>
      </span>
    </div>
    <input v-if="!disabled && (multiple || !selected.length)" v-model="search" :id="`field-${field.name}`" type="search" class="w-full rounded border border-brand-control-border bg-brand-surface px-3 py-2 text-sm text-brand-text focus:outline-none focus:ring-1 focus:ring-brand-blue" placeholder="Buscar usuario por nombre o correo" />
    <div v-if="search && available.length" class="max-h-44 overflow-y-auto rounded border border-brand-control-border bg-brand-surface shadow-sm">
      <button v-for="user in available" :key="user.id" type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-brand-bg" @click="choose(user.id)">
        <span class="flex h-7 w-7 items-center justify-center rounded-full bg-brand-blue-bg text-xs font-bold text-brand-blue">{{ (user.fullName || user.email).slice(0, 2).toUpperCase() }}</span>
        <span>{{ user.fullName || user.email }} <small class="text-brand-text-muted">{{ user.roleName }}</small></span>
      </button>
    </div>
  </div>
</template>
