import type { PlanConcept } from '~/utils/planConcepts'

// HU-ERD-104c: lógica pura del aviso de límite de plan en el cliente -
// compartida entre composables/usePlanLimit.ts y sus pruebas unitarias.
// El consumo y los límites reales los calcula el servidor
// (GET /api/billing/plan-usage -> getPlanUsage en server/utils/billing.ts);
// acá solo se decide si crear uno más excedería el límite y cómo se muestra.

/** Entrada de consumo tal como la devuelve GET /api/billing/plan-usage. */
export interface PlanUsageEntry {
  concept: PlanConcept
  label: string
  used: number
  limit: number | null
  percent: number | null
}

/**
 * Devuelve la entrada del concepto si crear `increment` unidades más
 * excedería el límite, o null si hay cupo (o el concepto es ilimitado/desconocido).
 */
export function findPlanLimitBlock(usage: PlanUsageEntry[], concept: PlanConcept, increment = 1): PlanUsageEntry | null {
  const item = usage.find(entry => entry.concept === concept)
  if (!item || item.limit === null || item.used + increment <= item.limit) return null
  return item
}

/** Texto del aviso pedido en la HU: "Alcanzaste el límite de ... (23 de 10) ...". */
export function planLimitMessage(label: string, plan: string, used: number, limit: number): string {
  return `Alcanzaste el límite de ${label} de tu plan ${plan} (${used} de ${limit}). Mejora tu plan para continuar.`
}

export interface PlanLimitErrorData {
  code: 'plan_limit'
  concept?: PlanConcept
  used?: number
  limit?: number | null
  plan?: string
}

/**
 * Extrae `data` de un error 402 con code 'plan_limit' (los createError del
 * servidor llegan al cliente como FetchError con statusCode/status + data),
 * o null si el error es de otro tipo.
 */
export function planLimitErrorData(err: unknown): PlanLimitErrorData | null {
  const error = err as { statusCode?: number; status?: number; data?: PlanLimitErrorData & { code?: string } } | null
  const status = error?.statusCode ?? error?.status
  if (status !== 402 || error?.data?.code !== 'plan_limit') return null
  return error.data as PlanLimitErrorData
}
