export type DesignerChatMessage = { role: 'user' | 'assistant'; content: string; explanation?: string; warnings?: string[]; createdAt: string }
export type DesignerChatDraft = { id: string; content: string; createdAt: string; status: 'pending' | 'failed'; error: string; action: 'retry' | 'plan' }
export type DesignerChatEntry = DesignerChatMessage & { id: string; draft?: DesignerChatDraft }

export function designerExplanationSummary(explanation: string): string { return explanation.split('\n', 1)[0]?.trim() ?? '' }
export function designerExplanationBody(explanation: string): string { return explanation.slice(explanation.indexOf('\n') + 1).trim().replace(/^### ¿Por qué\?\s*/, '') }

export function toggleDesignerFocus<T extends { focused: boolean; chatWidth: number; inspectorWidth: number; canvasState: unknown }>(state: T): T {
  return { ...state, focused: !state.focused }
}

export function canSendDesignerChat(options: { busy: boolean; noCredits: boolean; dirty: boolean; applied: boolean }): boolean {
  return !options.busy && !options.noCredits && !options.dirty && !options.applied
}

export function beginDesignerChat(drafts: DesignerChatDraft[], content: string, id: string, createdAt: string, retryId?: string): DesignerChatDraft[] {
  if (retryId) return drafts.map(draft => draft.id === retryId ? { ...draft, status: 'pending', error: '', action: 'retry' } : draft)
  return [...drafts, { id, content, createdAt, status: 'pending', error: '', action: 'retry' }]
}

export function failDesignerChat(drafts: DesignerChatDraft[], id: string, code?: string, status?: number): DesignerChatDraft[] {
  const credits = code === 'ai_credits' || status === 402
  const error = credits ? 'No tienes créditos suficientes para generar la propuesta.' : code === 'ai_unavailable' || status === 503 ? 'La IA no está disponible ahora. No se cobraron créditos.' : 'No se pudo generar la propuesta. No se cobraron créditos.'
  return drafts.map(draft => draft.id === id ? { ...draft, status: 'failed', error, action: credits ? 'plan' : 'retry' } : draft)
}

export function designerChatEntries(messages: DesignerChatMessage[], drafts: DesignerChatDraft[]): DesignerChatEntry[] {
  const persisted = messages.map((message, index) => ({ ...message, id: `saved-${index}-${message.createdAt}` }))
  const local = drafts.map(draft => ({ role: 'user' as const, content: draft.content, createdAt: draft.createdAt, id: draft.id, draft }))
  return [...persisted, ...local].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}
