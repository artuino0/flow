export type UsageResource = 'storageBytes' | 'users' | 'sites' | 'automationExecutions' | 'emails'
export interface UsageItem { resourceKey: UsageResource; quantity: number; limit: number | null; percentUsed: number | null; isOverLimit: boolean }
export interface Plan { id: string; code: string; name: string; description: string; monthlyPriceCents: number; annualPriceCents: number; currency: string; limits: Record<string, number | null>; blockedBy: Array<{ concept: string; label: string; used: number; limit: number }> }
export interface Invoice {
  id: string
  status: string
  totalCents: number
  amountPaidCents: number
  currency: string
  issuedAt: string | null
  periodStart?: string | null
  periodEnd?: string | null
  hostedInvoiceUrl: string | null
  invoicePdfUrl: string | null
}
export interface BillingOverview {
  stripeConfigured: boolean
  subscription: { id: string; status: string; billingInterval: string; stripeCustomerId: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; plan: Plan } | null
  usage: UsageItem[]
  invoices: Invoice[]
  usageHistory: Array<{ resourceKey: UsageResource; quantity: number; limitValue: number | null; capturedOn: string }>
}

