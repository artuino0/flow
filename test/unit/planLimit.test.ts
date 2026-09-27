import { describe, it, expect } from 'vitest'
import { findPlanLimitBlock, planLimitErrorData, planLimitMessage, type PlanUsageEntry } from '../../utils/planLimit'

function entry(concept: PlanUsageEntry['concept'], used: number, limit: number | null, label = concept): PlanUsageEntry {
  return { concept, label, used, limit, percent: null }
}

describe('findPlanLimitBlock (HU-ERD-104c)', () => {
  it('devuelve null cuando crear uno más cabe en el límite', () => {
    expect(findPlanLimitBlock([entry('modules', 8, 10)], 'modules')).toBeNull()
    expect(findPlanLimitBlock([entry('modules', 9, 10)], 'modules')).toBeNull()
  })

  it('bloquea cuando used + 1 excede el límite', () => {
    expect(findPlanLimitBlock([entry('modules', 23, 10)], 'modules')).toMatchObject({ concept: 'modules', used: 23, limit: 10 })
    expect(findPlanLimitBlock([entry('sites', 1, 1)], 'sites')).toMatchObject({ concept: 'sites', used: 1, limit: 1 })
    // Estando al tope exacto (10 de 10), crear uno más ya excede - mismo
    // criterio que assertPlanCapacity en el servidor (used + increment > limit).
    expect(findPlanLimitBlock([entry('modules', 10, 10)], 'modules')).toMatchObject({ concept: 'modules', used: 10, limit: 10 })
  })

  it('limit null es ilimitado y nunca bloquea', () => {
    expect(findPlanLimitBlock([entry('users', 10_000, null)], 'users')).toBeNull()
  })

  it('concepto ausente en el consumo no bloquea', () => {
    expect(findPlanLimitBlock([entry('modules', 5, 1)], 'sites')).toBeNull()
    expect(findPlanLimitBlock([], 'pages')).toBeNull()
  })

  it('respeta incrementos mayores a 1', () => {
    expect(findPlanLimitBlock([entry('storageBytes', 8, 10)], 'storageBytes', 2)).toBeNull()
    expect(findPlanLimitBlock([entry('storageBytes', 9, 10)], 'storageBytes', 2)).toMatchObject({ concept: 'storageBytes' })
  })
})

describe('planLimitMessage', () => {
  it('genera el texto pedido en la HU', () => {
    expect(planLimitMessage('Módulos personalizados', 'Starter', 23, 10))
      .toBe('Alcanzaste el límite de Módulos personalizados de tu plan Starter (23 de 10). Mejora tu plan para continuar.')
  })
})

describe('planLimitErrorData', () => {
  it('detecta el 402 plan_limit con statusCode', () => {
    const err = { statusCode: 402, data: { code: 'plan_limit', concept: 'modules', used: 3, limit: 2, plan: 'starter' } }
    expect(planLimitErrorData(err)).toMatchObject({ code: 'plan_limit', concept: 'modules' })
  })

  it('detecta el 402 plan_limit con status', () => {
    const err = { status: 402, data: { code: 'plan_limit' } }
    expect(planLimitErrorData(err)).toMatchObject({ code: 'plan_limit' })
  })

  it('descarta otros errores', () => {
    expect(planLimitErrorData({ statusCode: 500, data: { code: 'plan_limit' } })).toBeNull()
    expect(planLimitErrorData({ statusCode: 402, data: { code: 'otro' } })).toBeNull()
    expect(planLimitErrorData({ statusCode: 402 })).toBeNull()
    expect(planLimitErrorData(null)).toBeNull()
    expect(planLimitErrorData(new Error('x'))).toBeNull()
  })
})
