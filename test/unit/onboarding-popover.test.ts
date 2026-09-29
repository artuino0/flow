// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { driver, type Driver } from 'driver.js'
import { TOUR_POPOVER_CONTROLS, manualFieldExitIndex, waitForTourTarget, watchTourTargetRemoval } from '../../utils/onboardingTours'

let instance: Driver | undefined
afterEach(() => {
  instance?.destroy()
  instance = undefined
  document.body.replaceChildren()
})

describe('pie e interacción del aviso de Driver.js', () => {
  it('muestra Atrás, Siguiente y Omitir en un paso informativo y bloquea el enlace resaltado', () => {
    const target = document.createElement('a')
    target.href = '/ajustes'
    target.textContent = 'Módulos de Core'
    document.body.append(target)
    instance = driver({
      animate: false,
      allowScroll: false,
      disableActiveInteraction: true,
      showProgress: TOUR_POPOVER_CONTROLS.showProgress,
      showButtons: [...TOUR_POPOVER_CONTROLS.showButtons],
      steps: [{
        element: target,
        disableActiveInteraction: true,
        popover: {
          title: 'Módulos de Core',
          description: 'Puedes crear tus módulos manualmente.',
          showProgress: TOUR_POPOVER_CONTROLS.showProgress,
          showButtons: [...TOUR_POPOVER_CONTROLS.showButtons],
        },
      }],
      onPopoverRender: popover => {
        popover.footerButtons.replaceChildren()
        for (const label of ['Atrás', 'Siguiente', 'Omitir']) {
          const button = document.createElement('button')
          button.textContent = label
          popover.footerButtons.append(button)
        }
      },
    })
    instance.drive()
    const footer = document.querySelector<HTMLElement>('.driver-popover-footer')
    expect(footer).not.toBeNull()
    expect(footer?.style.display).not.toBe('none')
    expect([...footer!.querySelectorAll('button')].map(button => button.textContent)).toEqual(['Atrás', 'Siguiente', 'Omitir'])
    expect(document.querySelector('.driver-active-element')).toBe(target)
    expect(target.classList.contains('driver-no-interaction')).toBe(true)
  })
})

describe('cierre del modal durante el recorrido', () => {
  it('detecta que se cerró y vuelve a Agregar campo si no se guardó', async () => {
    vi.useFakeTimers()
    try {
      const modal = document.createElement('div')
      document.body.append(modal)
      const moved = vi.fn()
      watchTourTargetRemoval(document.body, modal, () => {
        void waitForTourTarget(() => document.querySelector('[data-tour="manual-field-saved"]'), () => true, { timeoutMs: 200, intervalMs: 50 })
          .then(saved => moved(manualFieldExitIndex(Boolean(saved))))
      })
      modal.remove()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(250)
      expect(moved).toHaveBeenCalledWith(3)
    } finally { vi.useRealTimers() }
  })

  it('continúa después de guardar aunque el modal se cierre a mitad de la explicación', async () => {
    vi.useFakeTimers()
    try {
      const modal = document.createElement('div')
      document.body.append(modal)
      const moved = vi.fn()
      watchTourTargetRemoval(document.body, modal, () => {
        void waitForTourTarget(() => document.querySelector('[data-tour="manual-field-saved"]'), () => true, { timeoutMs: 200, intervalMs: 50 })
          .then(saved => moved(manualFieldExitIndex(Boolean(saved))))
      })
      modal.remove()
      await Promise.resolve()
      const saved = document.createElement('div')
      saved.dataset.tour = 'manual-field-saved'
      document.body.append(saved)
      await vi.advanceTimersByTimeAsync(100)
      expect(moved).toHaveBeenCalledWith(9)
    } finally { vi.useRealTimers() }
  })
})
