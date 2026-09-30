import { describe, expect, it } from 'vitest'
import { MODULE_EDIT_TABS } from '../../utils/moduleEditTabs'
import { onboardingTours } from '../../utils/onboardingTours'
import { canReadChattitoHelp, chattitoHelpCatalog, chattitoHelpId, chattitoHelpMessage, chattitoHelpPreferenceKey, chattitoHelpStorageKey, helpForContext, shouldShowChattitoHelp, type ChattitoHelpVisibility } from '../../utils/chattitoHelp'

describe('catálogo de ayuda de Chattito', () => {
  it('cubre exactamente las nueve pestañas con textos y recorridos válidos', () => {
    expect(Object.keys(chattitoHelpCatalog)).toEqual(Object.values(MODULE_EDIT_TABS).map(tab => `module-edit:${tab}`))
    for (const tab of Object.values(MODULE_EDIT_TABS)) {
      const context = { page: 'module-edit', tab, moduleId: '123' } as const
      const help = helpForContext(context)!
      expect(chattitoHelpId(context)).toBe(`module-edit:${tab}`)
      expect(help.title.trim().length).toBeGreaterThan(0)
      expect(help.summary.trim().length).toBeGreaterThan(0)
      expect(help.bullets?.length ?? 0).toBeLessThanOrEqual(4)
      for (const bullet of help.bullets ?? []) expect(bullet.trim().length).toBeGreaterThan(0)
      if (help.tourId) expect(onboardingTours[help.tourId]).toBeDefined()
      // Los recorridos existentes no enseñan a editar un módulo.
      expect(help.tourId).toBeUndefined()
    }
  })
  it('no inventa ayuda para rutas desconocidas', () => {
    expect(helpForContext({ page: 'unknown' })).toBeNull()
    expect(chattitoHelpId({ page: 'unknown' })).toBeNull()
  })
  it('explica el flujo y genera el mensaje local completo', () => {
    const help = chattitoHelpCatalog['module-edit:flow']
    const message = chattitoHelpMessage(help)
    for (const text of [help.title, help.summary, ...help.bullets!]) expect(message).toContain(text)
    for (const text of ['Select', 'inicial', 'roles', 'Arrastra', 'bloqueo']) expect(message).toContain(text)
  })
  it('usa los mismos requisitos de administración que los recorridos', () => {
    for (const help of Object.values(chattitoHelpCatalog)) {
      expect(canReadChattitoHelp(help, { isAdmin: false, designerAvailable: true })).toBe(false)
      expect(canReadChattitoHelp(help, { isAdmin: true, designerAvailable: false })).toBe(true)
    }
  })
})

describe('visibilidad y persistencia', () => {
  const allowed: ChattitoHelpVisibility = { eligible: true, permitted: true, disabled: false, dismissed: false, seen: false, activeTour: false, conversationOpen: false }
  it('muestra ayuda cuando cumple todas las condiciones', () => {
    expect(shouldShowChattitoHelp(allowed)).toBe(true)
  })
  it.each(['eligible', 'permitted', 'disabled', 'dismissed', 'seen', 'activeTour', 'conversationOpen'] as const)('suprime ayuda por %s', key => {
    expect(shouldShowChattitoHelp({ ...allowed, [key]: !allowed[key] })).toBe(false)
  })
  it('aísla usuario, organización, pestaña y clase de preferencia sin usar el módulo', () => {
    const seen = chattitoHelpStorageKey('tenant', 'user', 'module-edit:flow', 'seen')
    expect(seen).toBe('flow-chattito-help:tenant:user:module-edit:flow:seen')
    const keys = [seen,
      chattitoHelpStorageKey('other', 'user', 'module-edit:flow', 'seen'),
      chattitoHelpStorageKey('tenant', 'other', 'module-edit:flow', 'seen'),
      chattitoHelpStorageKey('tenant', 'user', 'module-edit:fields', 'seen'),
      chattitoHelpStorageKey('tenant', 'user', 'module-edit:flow', 'dismissed'),
      chattitoHelpPreferenceKey('tenant', 'user'),
      chattitoHelpPreferenceKey('other', 'user'),
      chattitoHelpPreferenceKey('tenant', 'other')]
    expect(new Set(keys).size).toBe(keys.length)
    expect(chattitoHelpPreferenceKey('tenant', 'user')).toBe('flow-chattito-help:tenant:user:disabled')
  })
})
