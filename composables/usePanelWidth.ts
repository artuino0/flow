import { getCurrentInstance, onMounted, ref } from 'vue'

export interface PanelWidthOptions {
  storageKey: string
  defaultValue: number
  min: number
  max: number
  step?: number
}

export function usePanelWidth(options: PanelWidthOptions) {
  const step = options.step ?? 8
  const width = ref(options.defaultValue)

  function clamp(value: number) { return Math.min(options.max, Math.max(options.min, value)) }

  function load() {
    try {
      const stored = localStorage.getItem(options.storageKey)
      if (stored === null) return
      const parsed = Number(stored)
      // Replica la carga original del editor de Sites: valores ausentes, 0 o no numéricos se ignoran.
      if (!parsed) return
      width.value = clamp(parsed)
    } catch {
      // localStorage puede no estar disponible (SSR, modo privado): se conserva el valor por defecto.
    }
  }

  function setWidth(value: number) { width.value = clamp(value) }

  function persist() {
    try {
      localStorage.setItem(options.storageKey, String(width.value))
    } catch {
      // Sin localStorage el ancho sigue funcionando en memoria hasta el fin de la página.
    }
  }

  function reset() {
    width.value = options.defaultValue
    persist()
  }

  function stepBy(delta: number) {
    setWidth(width.value + delta)
    persist()
  }

  // En cliente la lectura ocurre tras montar (igual que el editor de Sites original) para no romper la hidratación.
  if (getCurrentInstance()) onMounted(load)

  return { width, step, clamp, load, setWidth, persist, reset, stepBy }
}
