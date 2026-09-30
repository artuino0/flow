<script setup lang="ts">
import type { NavigationLayout } from '~/utils/moduleNavigation'
const props = defineProps<{ entityId: string; entityName: string }>()
const { data, error, refresh } = await useFetch<{ layout: NavigationLayout; revision: number }>('/api/navigation', {
  key: `module-navigation-${props.entityId}`, headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined
})
const groupId = ref('')
const newName = ref('')
const newIcon = ref<string | null>('Package')
const creating = ref(false)
const saving = ref(false)
const message = ref('')
const toast = useToast()
watch(data, value => { if (value) groupId.value = value.layout.groups.find(group => group.entityIds.includes(props.entityId))?.id ?? '' }, { immediate: true })
const options = computed(() => [{ value: '', label: 'Sin grupo' }, ...(data.value?.layout.groups ?? []).map(group => ({
  value: group.id,
  label: group.parentId ? `${data.value?.layout.groups.find(parent => parent.id === group.parentId)?.name} › ${group.name}` : group.name
}))])
async function save() {
  if (!data.value || saving.value) return
  if (creating.value && !newName.value.trim()) { message.value = 'Escribe el nombre del grupo.'; return }
  saving.value = true
  message.value = ''
  try {
    const layout: NavigationLayout = JSON.parse(JSON.stringify(data.value.layout))
    const previous = layout.groups.find(group => group.entityIds.includes(props.entityId))
    if (creating.value) {
      const id = crypto.randomUUID()
      layout.groups.push({ id, name: newName.value.trim(), icon: newIcon.value, parentId: null, entityIds: [props.entityId] })
      if (previous) previous.entityIds = previous.entityIds.filter(id => id !== props.entityId)
    } else if (previous?.id !== groupId.value) {
      for (const group of layout.groups) group.entityIds = group.entityIds.filter(id => id !== props.entityId)
      layout.groups.find(group => group.id === groupId.value)?.entityIds.push(props.entityId)
    }
    await $fetch('/api/navigation', { method: 'PUT', body: { layout, revision: data.value.revision } })
    await refresh()
    await refreshNuxtData('appnav-modules')
    creating.value = false
    newName.value = ''
    toast.success('Ubicación actualizada', `${props.entityName} ya tiene su ubicación en el menú.`)
  } catch (err: any) { message.value = err?.data?.statusMessage || 'No se pudo guardar la ubicación.' }
  finally { saving.value = false }
}
</script>
<template>
  <section class="flex max-w-2xl flex-col rounded-lg border border-brand-border-light bg-brand-surface shadow-[0_1px_3px_0_#33475B14]">
    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-brand-border-light p-5"><div class="flex flex-col gap-1"><div class="flex items-center gap-2"><h2 class="text-[15px] font-bold text-brand-text">Ubicación en el menú</h2><ModuleTourHelpButton tab="menu" /></div><p class="text-sm text-brand-text-secondary">Agrupa {{ entityName }} dentro de un módulo funcional, por ejemplo Empaque y embarque.</p></div><button v-if="data && !error" type="button" :disabled="saving" class="rounded bg-brand-orange px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" data-tour="edit-menu-save" @click="save">{{ saving ? 'Guardando…' : 'Guardar ubicación' }}</button></div>
    <div class="space-y-5 p-5">
      <p v-if="error" role="alert" class="text-sm text-brand-error-text">No se pudo cargar la configuración del menú.</p>
      <template v-else-if="data">
        <fieldset :disabled="saving" data-tour="edit-menu-group" class="space-y-4">
          <ReportOptionSelect v-if="!creating" v-model="groupId" label="Grupo del menú" :options="options" />
          <div v-else class="flex items-end gap-3"><IconPicker v-model="newIcon" /><div class="flex-1"><label for="menu-group-name" class="mb-1.5 block text-xs font-semibold text-brand-text-secondary">Nombre del grupo</label><input id="menu-group-name" v-model="newName" maxlength="80" placeholder="Empaque y embarque" class="w-full rounded border border-brand-border px-3 py-2 text-sm text-brand-text" /></div></div>
          <button type="button" class="text-sm font-semibold text-brand-blue" @click="creating = !creating">{{ creating ? 'Elegir un grupo existente' : '+ Crear grupo' }}</button>
        </fieldset>
        <p class="text-xs text-brand-text-muted">Los catálogos siguen en los selectores. El acceso a los datos y la visibilidad por rol se configuran en Roles y permisos.</p>
        <p v-if="message" role="alert" class="text-sm text-brand-error-text">{{ message }} <button type="button" class="underline" @click="refresh()">Recargar</button></p>
        <div class="flex flex-wrap items-center gap-4"><NuxtLink to="/organizacion" class="text-sm text-brand-blue hover:underline">Ordenar y editar grupos →</NuxtLink></div>
      </template>
    </div>
  </section>
</template>
