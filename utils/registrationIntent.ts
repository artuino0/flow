export const LANDING_PLANS = ['agenda', 'starter', 'crecimiento', 'escala'] as const
export type RegistrationChoice = { plan: string; interval: 'month' | 'year'; utm_source?: string; utm_medium?: string; utm_campaign?: string; ref?: string }
export type RegistrationIntent = RegistrationChoice & { expiresAt: string }

/** Parámetros no confiables: nunca se aceptan precios ni destinos de retorno. */
export function normalizeRegistrationChoice(input: unknown): RegistrationChoice | null {
  if (!input || typeof input !== 'object') return null
  const values = input as Record<string, unknown>
  if (typeof values.plan !== 'string' || values.plan.length > 64) return null
  const plan = values.plan.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (!LANDING_PLANS.some(key => key === plan)) return null
  const rawInterval = values.interval
  if (rawInterval !== undefined && (typeof rawInterval !== 'string' || rawInterval.length > 16)) return null
  const interval = rawInterval === undefined ? 'month' : (rawInterval as string).trim().toLowerCase()
  if (interval !== 'month' && interval !== 'year') return null
  const choice: RegistrationChoice = { plan, interval }
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'ref'] as const) {
    const value = values[key]
    // Solo identificadores de campañas, sin texto libre, correos ni URLs.
    if (typeof value === 'string' && value.length <= 256 && !/[@:/\\?=]/.test(value)) {
      const clean = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 _.-]/g, '').trim().slice(0, 80)
      if (clean) choice[key] = clean
    }
  }
  return choice
}
