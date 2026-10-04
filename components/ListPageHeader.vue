<script setup lang="ts">
import { ChevronRight, RefreshCw, Search } from '@lucide/vue'

withDefaults(defineProps<{
  title: string
  description: string
  count?: number
  countNoun?: string
  countNounPlural?: string
  breadcrumb?: string
  searchPlaceholder?: string
  showSearch?: boolean
  showRefresh?: boolean
  showToolbar?: boolean
  refreshing?: boolean
}>(), {
  count: undefined,
  countNoun: 'registro',
  countNounPlural: '',
  breadcrumb: '',
  searchPlaceholder: 'Buscar...',
  showSearch: true,
  showRefresh: true,
  showToolbar: true,
  refreshing: false
})

const search = defineModel<string>('search', { default: '' })
defineEmits<{ refresh: [] }>()
</script>

<template>
  <div class="list-page-header">
    <header class="list-page-heading">
      <nav class="list-breadcrumb" aria-label="Migas de pan">
        <slot name="breadcrumb">
        <NuxtLink to="/">Inicio</NuxtLink>
        <ChevronRight :size="13" :stroke-width="1.75" />
        <span>{{ breadcrumb || title }}</span>
        </slot>
      </nav>

      <div class="list-title-row">
        <div class="list-title-copy">
          <div class="list-title-line">
            <h1>{{ title }}</h1>
            <slot name="title-help" />
            <span v-if="count !== undefined" class="list-count">
              {{ count }} {{ count === 1 ? countNoun : (countNounPlural || countNoun + 's') }}
            </span>
          </div>
          <p>{{ description }}</p>
        </div>
        <div class="list-header-actions"><slot name="actions" /></div>
      </div>
    </header>

    <div v-if="showToolbar" class="list-page-toolbar">
      <div class="list-toolbar-left">
        <label v-if="showSearch" class="list-search">
          <Search :size="14" :stroke-width="1.75" />
          <input v-model="search" type="search" :placeholder="searchPlaceholder" />
        </label>
        <slot name="toolbar-left" />
      </div>
      <div class="list-toolbar-right">
        <slot name="toolbar-right" />
        <button v-if="showRefresh" type="button" class="list-refresh" title="Actualizar" :disabled="refreshing" @click="$emit('refresh')">
          <RefreshCw :size="15" :stroke-width="1.75" :class="{ 'animate-spin': refreshing }" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.list-page-header{margin:calc(-1 * var(--list-page-gutter-y,32px)) calc(-1 * var(--list-page-gutter-x,32px)) 0;min-width:0;color:rgb(var(--brand-text))}
.list-page-heading{height:119px;border-bottom:1px solid rgb(var(--brand-border-light));background:rgb(var(--brand-surface));padding:20px 28px}
.list-breadcrumb{display:flex;height:16px;align-items:center;gap:4px;font-size:13px;font-weight:500;color:rgb(var(--brand-text-muted))}
.list-breadcrumb a{color:rgb(var(--brand-text-secondary))}.list-breadcrumb a:hover{color:rgb(var(--brand-blue))}.list-breadcrumb span{font-weight:700;color:rgb(var(--brand-text))}
.list-title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-top:14px}
.list-title-copy{display:flex;min-width:0;flex-direction:column;gap:4px}.list-title-line{display:flex;min-width:0;align-items:center;gap:10px}.list-title-line h1{overflow:hidden;margin:0;text-overflow:ellipsis;white-space:nowrap;font-size:24px;font-weight:700;line-height:29px}.list-title-copy>p{margin:0;font-size:13px;line-height:16px;color:rgb(var(--brand-text-secondary))}
.list-count{flex:none;border-radius:999px;background:rgb(var(--brand-neutral-bg));padding:3px 10px;font-size:12px;font-weight:700;line-height:15px;color:rgb(var(--brand-text-secondary))}
.list-header-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:10px}
.list-page-toolbar{display:flex;height:54px;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid rgb(var(--brand-border-light));background:rgb(var(--brand-surface));padding:10px 28px}
.list-toolbar-left,.list-toolbar-right{display:flex;min-width:0;align-items:center;gap:10px}.list-toolbar-left{flex:1}.list-toolbar-right{flex:none}
.list-search{display:flex;height:30px;width:220px;flex:none;align-items:center;gap:6px;border:1px solid rgb(var(--brand-border-light));border-radius:4px;background:rgb(var(--brand-bg));padding:0 10px;color:rgb(var(--brand-text-muted))}.list-search:focus-within{border-color:rgb(var(--brand-blue));box-shadow:0 0 0 1px rgb(var(--brand-blue))}.list-search input{min-width:0;flex:1;border:0;background:transparent;font-size:13px;color:rgb(var(--brand-text));outline:none}.list-search input::placeholder{color:rgb(var(--brand-text-muted))}.list-search input::-webkit-search-cancel-button{display:none}
.list-refresh{display:flex;height:32px;width:32px;align-items:center;justify-content:center;border:1px solid rgb(var(--brand-border-light));border-radius:4px;background:rgb(var(--brand-surface));color:rgb(var(--brand-text-secondary))}.list-refresh:hover{background:rgb(var(--brand-bg));color:rgb(var(--brand-text))}.list-refresh:disabled{cursor:wait;opacity:.55}
@media(max-width:720px){.list-page-header{}.list-page-heading{height:auto;min-height:119px;padding:16px}.list-title-row{flex-direction:column;align-items:stretch;gap:14px}.list-header-actions{justify-content:stretch}:deep(.list-header-actions > *){flex:1;justify-content:center}.list-page-toolbar{height:auto;min-height:54px;align-items:stretch;flex-direction:column;padding:10px 16px}.list-toolbar-left,.list-toolbar-right{width:100%}.list-toolbar-left{flex-wrap:wrap}.list-search{width:100%}.list-toolbar-right{justify-content:flex-end}}
</style>
