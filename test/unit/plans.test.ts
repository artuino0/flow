import { describe, expect, it } from 'vitest'
import { PLAN_CONCEPTS } from '../../utils/planConcepts'

describe('catálogo de planes ERD-100', () => {
  it('mantiene cerrada la lista de conceptos sin fijar sus valores en código', () => {
    expect(PLAN_CONCEPTS).toEqual(['users', 'usersIncluded', 'modules', 'activeFlows', 'executions', 'emails', 'storageBytes', 'stamps', 'sites', 'pages', 'forms', 'formSubmissions', 'aiCredits', 'agentQueries', 'agentUserDaily'])
  })
})
