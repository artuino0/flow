import { PLAN_CONCEPTS } from './planConcepts'

const BYTES_PER_GB = 1073741824

export function gbToBytes(value: number | string | null | undefined) {
  if (value === '' || value == null) return null
  const gb = Number(value)
  return Number.isFinite(gb) ? Math.round(gb * BYTES_PER_GB) : NaN
}

export function bytesToGb(bytes: number | null | undefined) {
  if (bytes == null) return null
  return Math.round((bytes / BYTES_PER_GB) * 1e6) / 1e6
}

export function normalizePlanLimits(limits: Record<string, number | string | null>) {
  return Object.fromEntries(PLAN_CONCEPTS.map(concept => [concept, concept === 'storageBytes' ? gbToBytes(limits[concept]) : limits[concept] === '' || limits[concept] == null ? null : Number(limits[concept])]))
}

export function priceInputToCents(value: string) {
  const amount = Number(value)
  return Number.isFinite(amount) ? Math.round(amount * 100) : NaN
}

export function normalizeOverrideValue(value: string, unlimited: boolean, concept?: string) {
  if (unlimited || value === '') return null
  return concept === 'storageBytes' ? gbToBytes(value) : Number(value)
}

export function formatPlanPrice(cents: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 }).format(cents / 100)
}

export function dateTimeLocalToIso(value: string) {
  return value ? new Date(value).toISOString() : null
}
