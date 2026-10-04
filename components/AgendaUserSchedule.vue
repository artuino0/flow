<script setup lang="ts">
import type { AgendaSchedule } from '~/utils/agenda'
defineProps<{ user: { id: string; fullName: string | null; email: string; phone: string | null; roleName: string | null; timezone: string | null; createdAt: string } }>()
defineEmits<{ profile: []; permissions: []; dirty: [boolean] }>()
const schedules = ref<AgendaSchedule[]>([])
</script>
<template>
  <div class="agenda-ui agenda-user-view" data-dark-ready="true">
    <ListPageHeader :title="user.fullName || user.email" description="Ficha del usuario y horario de atención en la agenda." breadcrumb="Usuarios / Horario de agenda" :show-toolbar="false"><template #breadcrumb><NuxtLink to="/usuarios">Usuarios</NuxtLink><span aria-hidden="true">/</span><span>{{ user.fullName || user.email }}</span><span aria-hidden="true">/</span><span>Horario de agenda</span></template></ListPageHeader>
    <div class="agenda-user-columns">
      <aside class="agenda-user-summary">
        <section class="settings-card agenda-profile-card"><div class="agenda-profile-line"><ChatAvatar :name="user.fullName || user.email" size="lg" /><div><p class="agenda-note">USUARIO</p><h2>{{ user.fullName || 'Usuario invitado' }}</h2><p class="agenda-note">Miembro desde {{ new Date(user.createdAt).toLocaleDateString('es-MX') }}</p></div></div><div class="agenda-profile-actions"><button type="button" class="settings-button" @click="$emit('profile')">Editar usuario</button><button type="button" class="settings-button" @click="$emit('permissions')">Ver permisos</button></div></section>
        <AgendaCard title="DATOS DEL USUARIO"><dl class="agenda-user-data"><div><dt>Correo electrónico</dt><dd>{{ user.email }}</dd></div><div><dt>Rol</dt><dd>{{ user.roleName || 'Sin rol asignado' }}</dd></div><div><dt>Teléfono</dt><dd>{{ user.phone || 'Sin capturar' }}</dd></div><div><dt>Último acceso</dt><dd>No disponible</dd></div><div><dt>Zona horaria</dt><dd>{{ user.timezone || 'La de la organización' }}</dd></div></dl></AgendaCard>
        <AgendaScheduleSummary :schedules="schedules" />
      </aside>
      <AgendaScheduleEditor :user-id="user.id" @change="schedules = $event" @dirty="$emit('dirty', $event)" />
    </div>
  </div>
</template>
<style scoped>
.agenda-user-view{margin:-32px;--list-page-gutter-x:0px;--list-page-gutter-y:0px;background:rgb(var(--brand-bg));min-height:100%}.agenda-user-columns{display:grid;grid-template-columns:320px minmax(0,1fr);gap:20px;padding:28px;align-items:start}.agenda-user-summary{display:grid;gap:16px;min-width:0}.agenda-profile-card{padding:20px}.agenda-profile-line{display:flex;gap:14px;align-items:center}.agenda-profile-line h2{font-size:18px}.agenda-profile-actions{display:flex;gap:8px;margin-top:14px}.agenda-profile-actions button{flex:1;font-size:12px}.agenda-user-data{margin:-20px -24px}.agenda-user-data>div{padding:10px 18px;border-bottom:1px solid rgb(var(--brand-border-light))}.agenda-user-data>div:last-child{border:0}.agenda-user-data dt{font-size:11px;color:rgb(var(--brand-text-muted))}.agenda-user-data dd{font-size:13px;margin-top:2px}:deep(.list-page-heading){height:113px}
@media(max-width:900px){.agenda-user-columns{grid-template-columns:minmax(0,1fr)}}@media(max-width:720px){.agenda-user-columns{padding:16px;gap:16px}.agenda-user-data{margin:-16px}.agenda-user-view :deep(.list-page-heading){height:auto;min-height:90px;padding:14px 16px}.agenda-user-view :deep(.list-title-line h1){font-size:20px}}
</style>
