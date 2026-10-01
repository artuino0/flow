import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { designerChattitoState, isAnimatedDesignerChattitoMessage } from '../../utils/designerChattito'

const resting = { generating: false, error: false, applied: false, validProposal: false, welcome: false, userText: 'Agrega pedidos', assistantText: 'Revisé el diseño.' }

describe('Chattito del diseñador (ERD-137)', () => {
  it('anima únicamente el último asistente, aunque después haya un usuario', () => {
    const messages = [{ id: 'a1', role: 'assistant' }, { id: 'u1', role: 'user' }, { id: 'a2', role: 'assistant' }, { id: 'u2', role: 'user' }] as const
    expect(messages.map(message => isAnimatedDesignerChattitoMessage(message, 'a2'))).toEqual([false, false, true, false])
    expect(messages.map(message => isAnimatedDesignerChattitoMessage(message, undefined))).toEqual([false, false, false, false])
    expect(isAnimatedDesignerChattitoMessage({ id: 'a2', role: 'user' }, 'a2')).toBe(false)
  })

  it('muestra typing durante generación, iteración y reparación, incluso con errores previos', () => {
    expect(designerChattitoState({ ...resting, generating: true })).toBe('typing')
    expect(designerChattitoState({ ...resting, generating: true, error: true, applied: true, validProposal: true })).toBe('typing')
  })

  it('celebra una propuesta válida y la bienvenida existente', () => {
    expect(designerChattitoState({ ...resting, validProposal: true })).toBe('happy')
    expect(designerChattitoState({ ...resting, welcome: true })).toBe('happy')
    expect(designerChattitoState({ ...resting, userText: '¡Hola!' })).toBe('happy')
    expect(designerChattitoState({ ...resting, assistantText: 'Buenos días' })).toBe('happy')
  })

  it('celebra aplicar con éxito y el agradecimiento o aceptación del usuario', () => {
    expect(designerChattitoState({ ...resting, applied: true })).toBe('special')
    for (const userText of ['Muchas gracias', 'Perfecto', 'De acuerdo', 'Sí acepto']) {
      expect(designerChattitoState({ ...resting, validProposal: true, userText })).toBe('special')
    }
  })

  it('mantiene idle ante errores y en el resto, sin interpretar aceptación del asistente como éxito', () => {
    expect(designerChattitoState(resting)).toBe('idle')
    expect(designerChattitoState({ ...resting, assistantText: 'Perfecto, revisé el diseño.' })).toBe('idle')
    expect(designerChattitoState({ ...resting, error: true, validProposal: true, welcome: true, applied: true, userText: 'Gracias' })).toBe('idle')
  })

  it('integra el personaje sin compartir estado global ni perder los destinos del recorrido', () => {
    const page = readFileSync(new URL('../../pages/disenador.vue', import.meta.url), 'utf8')
    expect(page).toContain('v-for="message in chatEntries"')
    expect(page).toContain('<ChattitoMessageAvatar v-if="message.role === \'assistant\'" :animated="isAnimatedDesignerChattitoMessage(message, lastAssistantId)" :state="designerAvatarState" size="sm" aria-hidden="true"')
    expect(page).toContain('<ChattitoMessageAvatar v-if="!lastAssistantId"')
    expect(page).toContain('v-if="!chatEntries.length"')
    expect(page).toContain('const designerAvatarState = computed(')
    expect(page).not.toContain('useChattitoPanel')
    expect(page).not.toContain('<ChattitoPanel')
    for (const target of ['designer', 'designer-prompt', 'designer-canvas', 'designer-review']) {
      expect(page).toContain(`data-tour="${target}"`)
    }
    expect(page).toContain('<textarea id="designer-prompt" v-model="prompt"')
    expect(page).toContain('Describe tu negocio o el cambio que necesitas.')
  })
})
