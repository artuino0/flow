export const PLAN_CONCEPTS = [
  'users', 'usersIncluded', 'modules', 'activeFlows', 'executions', 'emails', 'storageBytes', 'stamps',
  'sites', 'pages', 'forms', 'formSubmissions'
] as const
export type PlanConcept = (typeof PLAN_CONCEPTS)[number]
