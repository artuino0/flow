import { PLAN_CONCEPTS } from './planConcepts'

export function normalizePlanLimits(limits: Record<string, number | string | null>) {
  return Object.fromEntries(PLAN_CONCEPTS.map(concept => [concept, limits[concept] === '' || limits[concept] == null ? null : Number(limits[concept])]))
}

export function priceInputToCents(value: string) {
  const amount = Number(value)
  return Number.isFinite(amount) ? Math.round(amount * 100) : NaN
}

export function normalizeOverrideValue(value: string, unlimited: boolean) {
  return unlimited || value === '' ? null : Number(value)
}

export function formatPlanPrice(cents: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 }).format(cents / 100)
}

export function dateTimeLocalToIso(value: string) {
  return value ? new Date(value).toISOString() : null
}
