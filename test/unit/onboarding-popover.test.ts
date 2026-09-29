// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { driver, type Driver } from 'driver.js'
import { TOUR_POPOVER_CONTROLS } from '../../utils/onboardingTours'

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
