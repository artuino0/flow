<script setup lang="ts">
import type { ChattitoState } from '~/utils/chattito'

withDefaults(defineProps<{ animated: boolean; state?: ChattitoState; size?: 'sm' | 'md' | 'lg' }>(), { state: 'idle', size: 'md' })
</script>

<template>
  <ChattitoAvatar v-if="animated" :state="state" :size="size" auto-idle />
  <svg v-else :class="['chattito-message-avatar', `chattito-message-avatar--${size}`]" viewBox="0 0 200 200" aria-hidden="true" focusable="false"><use href="#chattito-symbol" /></svg>
</template>

<style scoped>
.chattito-message-avatar{display:block;flex:none;overflow:visible}.chattito-message-avatar--sm{width:42px;height:42px}.chattito-message-avatar--md{width:78px;height:78px}.chattito-message-avatar--lg{width:150px;height:150px}
</style>
