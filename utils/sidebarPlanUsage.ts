import type { PlanUsageEntry } from './planLimit'

export interface SidebarPlanSnapshot { plan: string; code: string; usage: PlanUsageEntry[]; scope: string }
export type UsageState = 'normal' | 'warning' | 'critical' | 'limit'

export function usageState(item: PlanUsageEntry | null | undefined): UsageState {
  if (!item || item.limit === null || item.percent === null) return 'normal'
  if (item.percent >= 100) return 'limit'
  if (item.percent >= 90) return 'critical'
  if (item.percent >= 80) return 'warning'
  return 'normal'
}

export function sidebarResource(usage: PlanUsageEntry[]): PlanUsageEntry | null {
  return usage.find(item => item.concept === 'storageBytes') ?? null
}

export function resourcePercent(item: PlanUsageEntry): number | null {
  if (item.limit === null || item.percent === null) return null
  return Math.max(0, Math.min(100, item.percent))
}

export function usageAmount(concept: string, value: number): string {
  const number = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 })
  if (concept !== 'storageBytes') return number.format(value)
  const unit = value >= 1024 ** 3 ? 'GB' : value >= 1024 ** 2 ? 'MB' : 'KB'
  return `${number.format(value / (unit === 'GB' ? 1024 ** 3 : unit === 'MB' ? 1024 ** 2 : 1024))} ${unit}`
}

export function usageText(item: PlanUsageEntry): string {
  const used = usageAmount(item.concept, item.used)
  return item.limit === null ? `${used} usados · Ilimitado` : `${used} de ${usageAmount(item.concept, item.limit)} usados`
}

export const usageMessages: Record<UsageState, string> = {
  normal: 'Tu consumo está dentro del límite',
  warning: 'Tu consumo está cerca del límite',
  critical: 'Aumenta tu plan para evitar interrupciones',
  limit: 'Has alcanzado el límite de este recurso'
}
export const usageActions: Record<UsageState, string> = {
  normal: 'Mejorar plan', warning: 'Revisar opciones', critical: 'Mejorar plan', limit: 'Ver planes'
}

// Los nombres de la API se conservan: sitios y correos no significan publicados/enviados.
export const detailConcepts = ['storageBytes', 'executions', 'users', 'sites', 'emails', 'stamps'] as const
