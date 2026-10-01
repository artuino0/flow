export class AgentResilience {
 active = 0
 failures = 0
 failureStart = 0
 openUntil = 0
 probing = false
 private rates = new Map<string, { count: number; start: number }>()
 constructor(public maxConcurrency = 4, public perMinute = 12, public failureThreshold = 3, public windowMs = 60_000, public openMs = 60_000) {}
 rate(key: string, now = Date.now()) {
  if (this.rates.size > 5000) for (const [id,item] of this.rates) if (now - item.start >= 60_000) this.rates.delete(id)
  const item = this.rates.get(key)
  const state = item && now - item.start < 60_000 ? item : { count: 0, start: now }
  this.rates.set(key, state); state.count++
  return state.count > this.perMinute ? Math.ceil((state.start + 60_000 - now) / 1000) : 0
 }
 enter(now = Date.now()) {
  if (this.openUntil > now || this.active >= this.maxConcurrency || (this.openUntil && this.probing)) return false
  if (this.openUntil) this.probing = true
  this.active++; return true
 }
 leave(success: boolean | null, now = Date.now()) {
  this.active--; this.probing = false
  if (success === null) return
  if (success) { this.failures = 0; this.openUntil = 0; return }
  if (now - this.failureStart > this.windowMs) { this.failures = 0; this.failureStart = now }
  if (++this.failures >= this.failureThreshold) this.openUntil = now + this.openMs
 }
}
const positive = (key: string, fallback: number) => { const value = Number(process.env[key]); return Number.isFinite(value) && value > 0 ? value : fallback }
export const agentResilience = new AgentResilience(positive('AGENT_AI_MAX_CONCURRENCY',4),positive('AGENT_AI_PER_MINUTE',12),positive('AGENT_AI_CIRCUIT_FAILURES',3),positive('AGENT_AI_CIRCUIT_WINDOW_MS',60_000),positive('AGENT_AI_CIRCUIT_OPEN_MS',60_000))
export const agentTimeoutMs = () => positive('AGENT_AI_TIMEOUT_MS',12_000)
