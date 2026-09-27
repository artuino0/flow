import type { PlanConcept } from '~/utils/planConcepts'
import { findPlanLimitBlock, planLimitErrorData, planLimitMessage, type PlanUsageEntry } from '~/utils/planLimit'

// HU-ERD-104c: aviso de límite de plan al presionar un botón de crear.
// El servidor ya bloquea los guardados (assertPlanCapacity en
// server/utils/billing.ts responde 402 con data.code='plan_limit'); este
// composable adelanta el aviso AL PRESIONAR el botón, para que el usuario no
// llene todo un asistente y recién al final se entere de que no puede crear.
//
// checkBeforeCreate(concept): true = puede continuar; false = se mostró el
// aviso (el llamador debe NO abrir el asistente/formulario).
// handlePlanLimitError(err): true si el error era un 402 'plan_limit' (ya se
// mostró el aviso) - para los guardados donde el consumo cambió entre medias.

interface PlanUsageResponse {
  plan: string
  code: string
  usage: PlanUsageEntry[]
}

export function usePlanLimit() {
  const { data: isAdmin } = useIsAdmin()
  const { confirm } = useConfirm()

  async function showLimitNotice(message: string) {
    const upgrade = await confirm({
      title: 'Límite del plan alcanzado',
      message,
      confirmLabel: 'Mejorar plan',
      cancelLabel: 'Cerrar'
    })
    if (upgrade) await navigateTo('/ajustes?section=plan')
  }

  async function checkBeforeCreate(concept: PlanConcept): Promise<boolean> {
    if (import.meta.server) return true
    // GET /api/billing/plan-usage es solo admins (requireAdminRole): si el
    // usuario no es admin no bloqueamos en el cliente y dejamos que el
    // servidor responda lo que corresponda al guardar.
    if (!isAdmin.value) return true
    let snapshot: PlanUsageResponse
    try {
      snapshot = await $fetch<PlanUsageResponse>('/api/billing/plan-usage')
    } catch {
      // Sin consumo consultable no hay aviso preventivo; el servidor igual cuida el límite.
      return true
    }
    const blocked = findPlanLimitBlock(snapshot.usage, concept)
    if (!blocked) return true
    await showLimitNotice(planLimitMessage(blocked.label, snapshot.plan, blocked.used, blocked.limit!))
    return false
  }

  async function handlePlanLimitError(err: unknown): Promise<boolean> {
    const data = planLimitErrorData(err)
    if (!data) return false
    // Reconstruye el mismo texto del aviso preventivo (label y nombre del
    // plan); si el consumo no se puede consultar, usa el mensaje del servidor.
    let message = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
    try {
      const snapshot = await $fetch<PlanUsageResponse>('/api/billing/plan-usage')
      const item = snapshot.usage.find(entry => entry.concept === data.concept)
      if (item && typeof data.used === 'number' && typeof data.limit === 'number') {
        message = planLimitMessage(item.label, snapshot.plan, data.used, data.limit)
      }
    } catch {}
    await showLimitNotice(message || 'Alcanzaste un límite de tu plan. Mejora tu plan para continuar.')
    return true
  }

  return { checkBeforeCreate, handlePlanLimitError }
}
