<script setup lang="ts">
import { ArrowDown, ArrowUp, Bell, CopyPlus, Mail, Pencil, Trash2, Webhook } from '@lucide/vue'
defineProps<{
  title: string; summary: string; actionType: string; selected?: boolean
  negative?: boolean; first?: boolean; last?: boolean
}>()
defineEmits<{ select: []; remove: []; move: [direction: -1 | 1] }>()
</script>

<template>
  <div class="workflow-action" :class="{ selected, negative }">
    <button type="button" class="node-main" :aria-label="`Configurar ${title}`" @click="$emit('select')">
      <span class="node-icon" :class="actionType"><Mail v-if="actionType === 'email'" /><Webhook v-else-if="actionType === 'webhook'" /><Bell v-else-if="actionType === 'notification'" /><CopyPlus v-else-if="actionType === 'upsert_record'" /><Pencil v-else /></span>
      <span class="node-copy"><strong>{{ title }}</strong><span>{{ summary }}</span></span>
    </button>
    <div class="node-tools">
      <button type="button" :disabled="first" aria-label="Mover acción arriba" @click="$emit('move', -1)"><ArrowUp /></button>
      <button type="button" :disabled="last" aria-label="Mover acción abajo" @click="$emit('move', 1)"><ArrowDown /></button>
      <button type="button" aria-label="Editar acción" @click="$emit('select')"><Pencil /></button>
      <button type="button" aria-label="Eliminar acción" @click="$emit('remove')"><Trash2 /></button>
    </div>
  </div>
</template>

<style scoped>
.workflow-action{width:100%;border:1px solid rgb(var(--brand-border-light));border-radius:8px;background:rgb(var(--brand-surface));box-shadow:0 1px 3px rgb(var(--brand-shadow) / 0.0784313725490196);position:relative}
.workflow-action.selected{border-color:rgb(var(--brand-blue));box-shadow:0 0 0 1px rgb(var(--brand-blue))}
.node-main{display:flex;align-items:flex-start;gap:12px;padding:16px 16px 4px;width:100%;text-align:left;border-radius:8px}
.node-main:hover{background:rgb(var(--brand-dashboard-soft))}.node-main:focus-visible,.node-tools button:focus-visible{outline:2px solid rgb(var(--brand-blue));outline-offset:2px}
.node-icon{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:8px;background:rgb(var(--brand-warning-bg));color:rgb(var(--brand-warning-text));flex-shrink:0}
.node-icon svg{width:19px;height:19px;stroke-width:1.75}.node-icon.email{background:rgb(var(--brand-success-bg));color:rgb(var(--brand-success-text))}.node-icon.webhook,.node-icon.upsert_record{background:rgb(var(--brand-blue-bg));color:rgb(var(--brand-blue))}.node-icon.notification{background:rgb(var(--brand-purple-bg));color:rgb(var(--brand-purple-text))}.negative .node-icon{background:rgb(var(--brand-trigger-no-bg));color:rgb(var(--brand-trigger-no-text))}
.node-copy{display:flex;flex-direction:column;gap:4px;min-width:0}.node-copy strong{font-size:14px;font-weight:700;color:rgb(var(--brand-text));line-height:1.35}.node-copy>span{font-size:13px;line-height:1.4;color:rgb(var(--brand-text-secondary));overflow-wrap:anywhere;white-space:pre-line}
.node-tools{display:flex;gap:6px;padding:0 12px 10px 62px}.node-tools button{color:rgb(var(--brand-sites-muted));padding:5px;border-radius:4px}.node-tools button:hover{background:rgb(var(--brand-bg));color:rgb(var(--brand-blue))}.node-tools button:disabled{opacity:.3;cursor:default}.node-tools svg{width:14px;height:14px;stroke-width:1.75}
</style>
