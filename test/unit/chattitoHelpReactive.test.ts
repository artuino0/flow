import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope, nextTick, reactive, ref, watch, type EffectScope, type Ref } from 'vue'
import type { ChattitoContext } from '../../utils/chattitoContext'
import { useChattitoHelp } from '../../composables/useChattitoHelp'

const harness = vi.hoisted(() => ({ context: undefined as unknown, preferences: undefined as unknown }))
vi.mock('../../composables/useChattitoHelpPreferences', () => ({ useChattitoHelpPreferences: () => harness.preferences }))
vi.mock('../../composables/useChattitoContext', () => ({ useChattitoContext: () => ({ context: harness.context }) }))

describe('ayuda reactiva sin refrescar', () => {
  let scope: EffectScope
  let context: Ref<ChattitoContext>
  let panel: Ref<{ open: boolean; conversationStarted: boolean; avatarState: string; messages: { role: string; text: string }[] }>
  let user: Ref<{ authenticated: boolean; tenantId: string; id: string; emailVerified: boolean; onboardingStatus: string }>
  let disabled: Ref<boolean>
  let activeId: Ref<string | null>
  let admin: Ref<boolean>
  let memory: Map<string, ReturnType<typeof ref>>
  let addMessage: ReturnType<typeof vi.fn>
  let startTour: ReturnType<typeof vi.fn>
  let tourAllowed: Ref<boolean>

  beforeEach(() => {
    scope = effectScope()
    context = ref<ChattitoContext>({ page: 'module-edit', tab: 'fields', moduleId: '1' })
    user = ref({ authenticated: true, tenantId: 'a', id: '1', emailVerified: true, onboardingStatus: 'complete' })
    panel = ref({ open: false, conversationStarted: false, avatarState: 'idle', messages: [{ role: 'assistant', text: 'Demo' }] })
    disabled = ref(false)
    activeId = ref<string | null>(null)
    admin = ref(true)
    memory = new Map()
    addMessage = vi.fn(message => panel.value.messages.push(message))
    startTour = vi.fn()
    tourAllowed = ref(true)
    harness.context = context
    harness.preferences = { ready: ref(true), disabled, setDisabled: (value: boolean) => { disabled.value = value } }
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useState', (key: string, init: () => unknown) => {
      if (!memory.has(key)) memory.set(key, ref(init()))
      return memory.get(key)
    })
    vi.stubGlobal('useChattitoContext', () => ({ context }))
    vi.stubGlobal('useChattitoHelpPreferences', () => harness.preferences)
    vi.stubGlobal('useAuth', () => ({ user }))
    vi.stubGlobal('useRoute', () => reactive({ path: '/modulos/1/editar', fullPath: '/modulos/1/editar?tab=fields', meta: { layout: 'default' } }))
    vi.stubGlobal('useIsAdmin', () => ({ data: admin, status: ref('success') }))
    vi.stubGlobal('useOnboarding', () => ({ activeId, canLaunchTour: () => tourAllowed.value, startTour }))
    vi.stubGlobal('useChattitoPanel', () => ({ panel, addMessage }))
  })
  afterEach(() => { scope.stop(); vi.unstubAllGlobals() })

  it('cambia de pestaña, mantiene el aviso durante la visita y no lo repite al volver', async () => {
    const help = scope.run(useChattitoHelp)!
    expect(help.visible.value).toBe(true)
    expect(help.help.value?.title).toBe('Campos')
    await nextTick()
    expect(help.visible.value).toBe(true)
    context.value = { page: 'module-edit', tab: 'flow', moduleId: '1' }
    await nextTick()
    expect(help.visible.value).toBe(true)
    expect(help.help.value?.title).toBe('Flujo de estados')
    context.value = { page: 'module-edit', tab: 'fields', moduleId: '2' }
    await nextTick()
    expect(help.visible.value).toBe(false)
  })
  it('abre el chat nuevo con la ayuda como primer mensaje, sin solicitudes de IA', async () => {
    const help = scope.run(useChattitoHelp)!
    help.explain()
    await nextTick()
    expect(panel.value.open).toBe(true)
    expect(panel.value.conversationStarted).toBe(true)
    expect(panel.value.messages).toHaveLength(1)
    expect(panel.value.messages[0]?.text).toContain('Campos')
    expect(addMessage).toHaveBeenCalledOnce()
    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ action: { kind: 'start-tour', tourId: 'editar-campos', originPath: '/modulos/1/editar?tab=fields' } }))
    expect(help.visible.value).toBe(false)
  })
  it('conserva los mensajes previos al explicar desde un panel cerrado', () => {
    panel.value.conversationStarted = true
    const help = scope.run(useChattitoHelp)!
    help.explain()
    expect(panel.value.messages).toHaveLength(2)
    expect(panel.value.messages[0]?.text).toBe('Demo')
  })
  it('espera al fin del recorrido y respeta una conversación abierta', async () => {
    activeId.value = 'bienvenida'
    const help = scope.run(useChattitoHelp)!
    expect(help.visible.value).toBe(false)
    activeId.value = null
    panel.value.open = true
    await nextTick()
    expect(help.visible.value).toBe(false)
    panel.value.open = false
    await nextTick()
    expect(help.visible.value).toBe(true)
  })
  it('espera los permisos y la verificación; permite reactivar una preferencia apagada', async () => {
    disabled.value = true
    admin.value = false
    user.value.emailVerified = false
    const help = scope.run(useChattitoHelp)!
    expect(help.visible.value).toBe(false)
    admin.value = true
    user.value.emailVerified = true
    await nextTick()
    expect(help.visible.value).toBe(false)
    disabled.value = false
    await nextTick()
    expect(help.visible.value).toBe(true)
    help.dismiss()
    await nextTick()
    expect(help.visible.value).toBe(false)
    user.value = { ...user.value, id: '2' }
    await nextTick()
    expect(help.visible.value).toBe(true)
  })
  it('espera una respuesta pendiente aunque el panel esté cerrado', async () => {
    panel.value.avatarState = 'typing'
    const help = scope.run(useChattitoHelp)!
    expect(help.visible.value).toBe(false)
    panel.value.avatarState = 'idle'
    await nextTick()
    expect(help.visible.value).toBe(true)
  })
  it('lanza el recorrido del aviso y no lo repite al cerrar o terminar', async () => {
    const help = scope.run(useChattitoHelp)!
    expect(help.tourId.value).toBe('editar-campos')
    help.runTour()
    expect(startTour).toHaveBeenCalledExactlyOnceWith('editar-campos')
    activeId.value = 'editar-campos'
    await nextTick()
    activeId.value = null
    await nextTick()
    expect(help.visible.value).toBe(false)
    help.runTour()
    expect(startTour).toHaveBeenCalledOnce()
  })
  it('omite la acción del mensaje y el lanzamiento si no puede ejecutar el recorrido', () => {
    tourAllowed.value = false
    const help = scope.run(useChattitoHelp)!
    expect(help.tourId.value).toBeNull()
    help.runTour()
    expect(startTour).not.toHaveBeenCalled()
    help.explain()
    expect(addMessage).toHaveBeenCalledWith(expect.not.objectContaining({ action: expect.anything() }))
  })
})
