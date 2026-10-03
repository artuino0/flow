<script setup lang="ts">
import { Trash2 } from '@lucide/vue'
definePageMeta({ layout: 'default', darkReady: true, fullBleed: true })
const search = ref('')
</script>

<template>
  <div class="sites-page">
    <ListPageHeader
      v-model:search="search"
      title="Papelera"
      description="Consulta y recupera sitios eliminados."
      :count="0"
      count-noun="sitio"
      search-placeholder="Buscar sitios eliminados..."
      :show-refresh="false"
    />
    <section class="empty-table">
      <div class="table-head"><span>Sitio</span><span>Eliminado por</span><span>Fecha</span><span /></div>
      <div class="empty-content"><span class="icon"><Trash2 /></span><strong>La papelera está vacía</strong><p>Los sitios eliminados aparecerán aquí.</p></div>
    </section>
  </div>
</template>

<style scoped>
.sites-page{min-height:100%;width:100%;background:rgb(var(--brand-bg));padding:32px;color:rgb(var(--brand-text))}.empty-table{margin-top:20px;overflow:hidden;border:1px solid rgb(var(--brand-border-light));border-radius:6px;background:rgb(var(--brand-surface))}.table-head{display:grid;height:40px;grid-template-columns:2fr 1fr 1fr 50px;align-items:center;border-bottom:1px solid rgb(var(--brand-border-light));background:rgb(var(--brand-bg));color:rgb(var(--brand-text-secondary));font-size:11.5px;font-weight:700}.table-head span{padding:0 16px}.empty-content{display:flex;min-height:280px;align-items:center;justify-content:center;flex-direction:column;text-align:center}.icon{display:grid;height:48px;width:48px;place-items:center;border-radius:8px;background:rgb(var(--brand-kanban-divider));color:rgb(var(--brand-sites-icon))}.icon svg{height:22px;width:22px}.empty-content strong{margin-top:14px;font-size:15px}.empty-content p{margin:6px 0;color:rgb(var(--brand-sites-icon));font-size:13px}@media(max-width:640px){.sites-page{padding:32px}}
</style>
