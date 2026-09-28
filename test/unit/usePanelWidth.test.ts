import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { usePanelWidth } from '../../composables/usePanelWidth'

function createLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size }
  }
}

let storage: ReturnType<typeof createLocalStorage>
beforeEach(() => {
  storage = createLocalStorage()
  vi.stubGlobal('localStorage', storage)
})
afterEach(() => vi.unstubAllGlobals())

const options = { storageKey: 'flow-test-width', defaultValue: 250, min: 215, max: 340 }

describe('usePanelWidth', () => {
  it('inicia en el valor por defecto', () => {
    const panel = usePanelWidth(options)
    expect(panel.width.value).toBe(250)
  })

  it('limita el ancho entre min y max', () => {
    const panel = usePanelWidth(options)
    panel.setWidth(500)
    expect(panel.width.value).toBe(340)
    panel.setWidth(10)
    expect(panel.width.value).toBe(215)
    panel.setWidth(300)
    expect(panel.width.value).toBe(300)
  })

  it('stepBy aplica el paso, limita y persiste', () => {
    const panel = usePanelWidth(options)
    panel.stepBy(8)
    expect(panel.width.value).toBe(258)
    expect(storage.getItem('flow-test-width')).toBe('258')
    panel.setWidth(338)
    panel.stepBy(8)
    expect(panel.width.value).toBe(340)
    panel.stepBy(-800)
    expect(panel.width.value).toBe(215)
  })

  it('persist guarda y load restaura con límites', () => {
    const panel = usePanelWidth(options)
    panel.setWidth(300)
    panel.persist()
    expect(storage.getItem('flow-test-width')).toBe('300')

    const restored = usePanelWidth(options)
    restored.load()
    expect(restored.width.value).toBe(300)

    storage.setItem('flow-test-width', '9999')
    const clamped = usePanelWidth(options)
    clamped.load()
    expect(clamped.width.value).toBe(340)
  })

  it('mantiene las claves, valores iniciales y límites del editor de Sites', () => {
    const sidebar = usePanelWidth({ storageKey: 'flow-sites-sidebar-width', defaultValue: 250, min: 215, max: 340 })
    const code = usePanelWidth({ storageKey: 'flow-sites-code-percent', defaultValue: 50, min: 28, max: 72 })
    expect([sidebar.width.value, code.width.value]).toEqual([250, 50])
    storage.setItem('flow-sites-sidebar-width', '100')
    storage.setItem('flow-sites-code-percent', '90')
    sidebar.load()
    code.load()
    expect([sidebar.width.value, code.width.value]).toEqual([215, 72])
    sidebar.persist()
    code.persist()
    expect(storage.getItem('flow-sites-sidebar-width')).toBe('215')
    expect(storage.getItem('flow-sites-code-percent')).toBe('72')
  })

  it('ignora valores guardados ausentes, cero o no numéricos', () => {
    let panel = usePanelWidth(options)
    panel.load()
    expect(panel.width.value).toBe(250)

    storage.setItem('flow-test-width', 'abc')
    panel = usePanelWidth(options)
    panel.load()
    expect(panel.width.value).toBe(250)

    storage.setItem('flow-test-width', '0')
    panel = usePanelWidth(options)
    panel.load()
    expect(panel.width.value).toBe(250)
  })

  it('reset vuelve al valor por defecto y persiste', () => {
    const panel = usePanelWidth(options)
    panel.setWidth(300)
    panel.persist()
    panel.reset()
    expect(panel.width.value).toBe(250)
    expect(storage.getItem('flow-test-width')).toBe('250')
  })

  it('sobrevive a un localStorage que lanza errores', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('bloqueado') },
      setItem: () => { throw new Error('bloqueado') }
    })
    const panel = usePanelWidth(options)
    expect(() => panel.load()).not.toThrow()
    expect(() => panel.persist()).not.toThrow()
    expect(panel.width.value).toBe(250)
  })
})
