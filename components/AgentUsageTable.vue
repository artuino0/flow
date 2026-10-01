<script setup lang="ts">
const props = withDefaults(defineProps<{ platform?: boolean; allowed?: boolean }>(), { platform: false, allowed: false })
type UsageUser = { userId: string; name: string | null; email: string; ai_calls: number; messages_total: number; last_used_at: string | null }
type OrganizationUsage = { tenantId: string; name: string; plan: string; ai_calls: number; messages_total: number; monthlyQuota: number | null; percentUsed: number | null; activeUsers: number; last_used_at: string | null; users?: UsageUser[] }
type UsageResponse = { month?: string; users?: UsageUser[]; totals?: { ai_calls: number }; quota?: { agentQueries: number | null }; organizations?: OrganizationUsage[] }
const { headers } = useAgentSession()
const data = ref<UsageResponse | null>(null)
const pending = ref(false)
const failed = ref(false)
const detail = ref<OrganizationUsage | null>(null)
const month = ref('')
async function load(tenantId?: string) {
 if (!props.allowed || !import.meta.client) return
 pending.value = true; failed.value = false
 try {
  const result = await $fetch<UsageResponse>(props.platform ? '/api/platform/agent-usage' : '/api/agent/usage', { headers: await headers(), query: { ...(month.value ? { month: month.value } : {}), ...(tenantId ? { tenantId } : {}) } })
  if (tenantId) detail.value = result.organizations?.[0] || null
  else { data.value = result; detail.value = null }
 } catch { failed.value = true }
 finally { pending.value = false }
}
watch(() => props.allowed, () => { if (props.allowed) void load(); else data.value = null })
onMounted(() => { void load() })
const users = computed(() => props.platform ? detail.value?.users || [] : data.value?.users || [])
const lastUsed = (date: string | null) => date ? new Date(date).toLocaleString('es-MX') : 'Sin uso'
</script>
<template>
 <section v-if="allowed" class="agent-usage" :aria-label="platform ? 'Uso del agente' : 'Uso de Chattito'">
  <header><h2>{{ platform ? 'Uso del agente' : 'Uso de Chattito' }}</h2><label>Mes <input v-model="month" type="month" @change="load()"></label><button type="button" :disabled="pending" @click="load()">Actualizar</button></header>
  <p v-if="pending" role="status">Cargando consumo…</p>
  <p v-else-if="failed" role="alert">No pudimos consultar el consumo. Puedes volver a intentarlo.</p>
  <template v-else-if="data">
   <p v-if="!platform">{{ data.totals?.ai_calls || 0 }} consultas con IA{{ data.quota?.agentQueries === null ? ' · Sin límite mensual' : ` de ${data.quota?.agentQueries || 0} al mes` }}. Los saludos y la ayuda del catálogo no consumen esta bolsa.</p>
   <div v-if="platform" class="agent-usage__scroll"><table><thead><tr><th>Organización</th><th>Plan</th><th>Consultas con IA</th><th>Mensajes</th><th>Cuota mensual</th><th>Uso</th><th>Usuarios activos</th><th>Última vez</th></tr></thead><tbody><tr v-for="org in data.organizations" :key="org.tenantId"><td><button type="button" @click="load(org.tenantId)">{{ org.name }}</button></td><td>{{ org.plan }}</td><td>{{ org.ai_calls }}</td><td>{{ org.messages_total }}</td><td>{{ org.monthlyQuota ?? 'Ilimitado' }}</td><td>{{ org.percentUsed === null ? 'Sin límite' : `${org.percentUsed}%` }}</td><td>{{ org.activeUsers }}</td><td>{{ lastUsed(org.last_used_at) }}</td></tr></tbody></table></div>
   <h3 v-if="detail">Usuarios de {{ detail.name }}</h3>
   <div v-if="users.length" class="agent-usage__scroll"><table><thead><tr><th>Usuario</th><th>Consultas con IA</th><th>Mensajes</th><th>Última vez</th></tr></thead><tbody><tr v-for="user in users" :key="user.userId"><td>{{ user.name || user.email }}<small v-if="user.name">{{ user.email }}</small></td><td>{{ user.ai_calls }}</td><td>{{ user.messages_total }}</td><td>{{ lastUsed(user.last_used_at) }}</td></tr></tbody></table></div>
   <p v-if="!platform && !users.some(user => user.messages_total)">Todavía no hay uso del agente registrado en este mes.</p>
   <p v-if="platform && !data.organizations?.length">No hay organizaciones con consumo disponible.</p>
  </template>
 </section>
</template>
<style scoped>
.agent-usage{overflow:hidden;border:1px solid #e5eaf0;border-radius:8px;background:#fdfefe;color:#33475b}.agent-usage header{display:flex;flex-wrap:wrap;align-items:center;gap:12px;border-bottom:1px solid #e5eaf0;padding:16px 24px}.agent-usage h2{flex:1;margin:0;font-size:14px}.agent-usage h3,.agent-usage p{margin:16px 24px;font-size:12px}.agent-usage label{font-size:12px}.agent-usage input{border:1px solid #cbd6e2;border-radius:4px;padding:5px}.agent-usage button{border:1px solid #cbd6e2;border-radius:4px;padding:6px 10px;color:#006e84;font-size:12px}.agent-usage button:disabled{opacity:.5}.agent-usage button:focus-visible,.agent-usage input:focus-visible{outline:2px solid #0091ae;outline-offset:2px}.agent-usage__scroll{overflow-x:auto}.agent-usage table{width:100%;border-collapse:collapse;font-size:12px}.agent-usage th{background:#f5f8fa;text-align:left;font-size:11px}.agent-usage th,.agent-usage td{padding:12px 16px;border-bottom:1px solid #e5eaf0;white-space:nowrap}.agent-usage small{display:block;color:#516f90;font-size:11px}
</style>
