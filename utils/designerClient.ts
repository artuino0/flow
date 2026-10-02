import type { DesignerWarningItem } from '~/utils/designerWarnings'
import type { DesignerReviewSummary } from '~/server/utils/moduleDesigner/review'

import type { Blueprint } from '~/server/utils/blueprint/schema'
import type { DesignerDiff, DesignerPositions } from '~/utils/designerGraph'
import type { NavigationLayout } from '~/utils/moduleNavigation'

export interface DesignerSession {
  id: string
  status: 'draft' | 'applied' | 'discarded' | 'error'
  messages: Array<{ role: 'user' | 'assistant'; content: string; explanation?: string; warnings?: string[]; warningItems?: DesignerWarningItem[]; createdAt: string }>
  blueprint: Blueprint
  creditsConsumed: number
  version: number
  createdAt: string
  updatedAt: string
}
export interface CreditBalance { included: number | null; used: number; includedRemaining: number | null; packages: number }
export interface DesignerValidation { normalized: Blueprint | null; errors: Array<{ path: string; message: string; code?: string }>; diff: DesignerDiff; merges: DesignerDiff['merges'] }
export interface DesignerGeneration { message: string; explanation: string; blueprint: Blueprint; warnings?: string[]; warningItems?: DesignerWarningItem[]; review?: DesignerReviewSummary; diff: DesignerDiff; merges: DesignerDiff['merges']; credits: CreditBalance; session?: DesignerSession }
export interface DesignerApply { modules: Array<{ id: string; slug: string }>; fields: Array<{ entityId: string; name: string }>; associations: string[]; layouts: string[]; workflows: string[] }
export interface DesignerApplication { id: string; createdAt: string; userId: string | null; userName: string | null; summary: string; modules: number; fields: number; associations: number; undoneAt: string | null; canUndo: boolean; reason: string | null; warnings: string[] }
export interface DesignerNavigation { layout: NavigationLayout; entities: Array<{ id: string; slug: string }> }

type Request = (url: string, options?: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown }) => Promise<unknown>
export function createDesignerClient(request: Request) {
  const sessionPath = (id: string) => `/api/module-designer/sessions/${encodeURIComponent(id)}`
  const send = async <T>(url: string, options?: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown }): Promise<T> => await request(url, options) as T
  return {
    listSessions: () => send<DesignerSession[]>('/api/module-designer/sessions'),
    listApplications: () => send<DesignerApplication[]>('/api/module-designer/applications'),
    undoApplication: (id: string, confirmPartial: boolean) => send<{ id: string; warnings: string[] }>(`/api/module-designer/applications/${encodeURIComponent(id)}/undo`, { method: 'POST', body: { confirmPartial } }),
    createSession: () => send<DesignerSession>('/api/module-designer/sessions', { method: 'POST', body: {} }),
    getSession: (id: string) => send<DesignerSession>(sessionPath(id)),
    getCurrent: () => send<Blueprint>('/api/blueprints/current'),
    getCredits: () => send<CreditBalance>('/api/billing/ai-credits'),
    getNavigation: () => send<DesignerNavigation>('/api/navigation'),
    getLayout: () => send<{ positions: DesignerPositions }>('/api/module-designer/layout'),
    putLayout: (positions: DesignerPositions) => send<{ positions: DesignerPositions }>('/api/module-designer/layout', { method: 'PUT', body: { positions } }),
    validate: (blueprint: Blueprint) => send<DesignerValidation>('/api/blueprints/validate', { method: 'POST', body: blueprint }),
    generate: (id: string, instruction: string) => send<DesignerGeneration>(`${sessionPath(id)}/messages`, { method: 'POST', body: { instruction } }),
    save: (id: string, blueprint: Blueprint) => send<DesignerValidation & { session: DesignerSession }>(`${sessionPath(id)}/blueprint`, { method: 'PUT', body: blueprint }),
    apply: (id: string) => send<DesignerApply>(`${sessionPath(id)}/apply`, { method: 'POST', body: {} })
  }
}
