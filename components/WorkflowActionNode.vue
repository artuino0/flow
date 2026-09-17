<script setup lang="ts">
import { ArrowDown, ArrowUp, Bell, Mail, Pencil, Trash2, Webhook } from '@lucide/vue'
defineProps<{
  title: string; summary: string; actionType: string; selected?: boolean
  negative?: boolean; first?: boolean; last?: boolean
}>()
defineEmits<{ select: []; remove: []; move: [direction: -1 | 1] }>()
</script>

<template>
  <div class="workflow-action" :class="{ selected, negative }">
    <button type="button" class="node-main" :aria-label="`Configurar ${title}`" @click="$emit('select')">
      <span class="node-icon" :class="actionType"><Mail v-if="actionType === 'email'" /><Webhook v-else-if="actionType === 'webhook'" /><Bell v-else-if="actionType === 'notification'" /><Pencil v-else /></span>
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
.workflow-action{width:100%;border:1px solid #e5eaf0;border-radius:8px;background:#fff;box-shadow:0 1px 3px #33475b14;position:relative}
.workflow-action.selected{border-color:#0091ae;box-shadow:0 0 0 1px #0091ae}
.node-main{display:flex;align-items:flex-start;gap:12px;padding:16px 16px 4px;width:100%;text-align:left;border-radius:8px}
.node-main:hover{background:#f8fafc}.node-main:focus-visible,.node-tools button:focus-visible{outline:2px solid #0091ae;outline-offset:2px}
.node-icon{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:8px;background:#fef0d2;color:#b3720a;flex-shrink:0}
.node-icon svg{width:19px;height:19px;stroke-width:1.75}.node-icon.email{background:#ccf1de;color:#0a7a4f}.node-icon.webhook{background:#eaf3f6;color:#0091ae}.node-icon.notification{background:#ede7fb;color:#6d3fc4}.negative .node-icon{background:#fce8e8;color:#c53030}
.node-copy{display:flex;flex-direction:column;gap:4px;min-width:0}.node-copy strong{font-size:14px;font-weight:700;color:#33475b;line-height:1.35}.node-copy>span{font-size:13px;line-height:1.4;color:#516f90;overflow-wrap:anywhere;white-space:pre-line}
.node-tools{display:flex;gap:6px;padding:0 12px 10px 62px}.node-tools button{color:#8da1b5;padding:5px;border-radius:4px}.node-tools button:hover{background:#f5f8fa;color:#0091ae}.node-tools button:disabled{opacity:.3;cursor:default}.node-tools svg{width:14px;height:14px;stroke-width:1.75}
</style>
