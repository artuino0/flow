<script setup lang="ts">
import { Trash2 } from '@lucide/vue'
definePageMeta({ layout: 'default', fullBleed: true })
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
.sites-page{min-height:100%;width:100%;background:#f5f8fa;padding:32px;color:#33475b}.empty-table{margin-top:20px;overflow:hidden;border:1px solid #e5eaf0;border-radius:6px;background:#fff}.table-head{display:grid;height:40px;grid-template-columns:2fr 1fr 1fr 50px;align-items:center;border-bottom:1px solid #e5eaf0;background:#f5f8fa;color:#516f90;font-size:11.5px;font-weight:700}.table-head span{padding:0 16px}.empty-content{display:flex;min-height:280px;align-items:center;justify-content:center;flex-direction:column;text-align:center}.icon{display:grid;height:48px;width:48px;place-items:center;border-radius:8px;background:#edf1f5;color:#7c98b6}.icon svg{height:22px;width:22px}.empty-content strong{margin-top:14px;font-size:15px}.empty-content p{margin:6px 0;color:#7c98b6;font-size:13px}@media(max-width:640px){.sites-page{padding:32px}}
</style>
