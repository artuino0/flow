export interface AccountPolicy { graceDays: number; retentionDays: number; warningDays: number[] }
export interface AccountLifecycle {
  phase: 'active' | 'payment_due' | 'suspended' | 'pending_deletion'
  paymentDueAt?: string | null; suspendAt?: string | null; deleteAt?: string | null
  reason?: string; exempt?: boolean; policy?: AccountPolicy
}
export function accountBlocked(account: AccountLifecycle) { return account.phase === 'suspended' || account.phase === 'pending_deletion' }
