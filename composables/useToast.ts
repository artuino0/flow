// Pedido directo del usuario ("aplica los toast, checa donde deben ir"): el
// diseno en Pencil tiene 4 notificaciones toast (Toast/Guardado, Toast/Editado,
// Toast/Error, Toast/Cargando - node ids gh7dB/z0ToRP/QhNbi/R8v5A) que hasta
// ahora no tenian ningun componente que las implementara (grep sin
// resultados en todo el proyecto antes de este cambio) - cada accion de
// crear/editar/eliminar solo mostraba (o no) un mensaje de error inline
// dentro de la propia pantalla, sin ninguna confirmacion visual de exito.
// Colores/iconos/textos base copiados 1:1 del .pen via las herramientas de
// Pencil (ver components/ToastContainer.vue para el detalle de cada variante).
//
// Estado compartido via useState (mecanismo SSR-safe propio de Nuxt) en vez
// de un modulo singleton casero - mismo criterio que cualquier otro estado
// global de la app, evita el riesgo de contaminacion entre requests en SSR
// que tendria un array a nivel de modulo. En la practica los toasts solo se
// disparan desde interacciones del usuario ya resueltas (fetch de mutacion
// terminado), o sea siempre en cliente, pero usar useState no tiene downside.
export type ToastVariant = 'success' | 'updated' | 'error' | 'loading'

export interface ToastItem {
  id: string
  variant: ToastVariant
  title: string
  description?: string
}

// `string | null` ademas de `string | undefined` en las funciones publicas
// de abajo - los mensajes de error de $fetch en esta app siempre se guardan
// en un `ref<string | null>` (patron establecido en todo el proyecto, ver
// nuevo.vue/editar.vue/etc.), asi que pasarlos directo a toast.error(...)
// sin castear en cada call site es el uso real esperado.
type ToastDescription = string | null | undefined

const AUTO_DISMISS_MS = 4500

function useToastState() {
  return useState<ToastItem[]>('toasts', () => [])
}

let counter = 0
function nextId(): string {
  counter += 1
  return `toast-${Date.now()}-${counter}`
}

export function useToast() {
  const toasts = useToastState()

  function dismiss(id: string) {
    const idx = toasts.value.findIndex((t) => t.id === id)
    if (idx !== -1) toasts.value.splice(idx, 1)
  }

  function push(variant: ToastVariant, title: string, description?: ToastDescription, autoDismiss = true): string {
    const id = nextId()
    toasts.value.push({ id, variant, title, description: description ?? undefined })
    if (autoDismiss && import.meta.client) {
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
    }
    return id
  }

  return {
    toasts,
    // Toast/Guardado (verde, circle-check) - creaciones y guardados genericos
    // (un registro nuevo, un modulo nuevo, un rol nuevo, etc.).
    success: (title: string, description?: ToastDescription) => push('success', title, description),
    // Toast/Editado (celeste/info, pencil-line) - especificamente la edicion
    // de algo que ya existia (un registro, un campo, una configuracion).
    updated: (title: string, description?: ToastDescription) => push('updated', title, description),
    // Toast/Error (rojo, circle-x) - fallo de cualquier mutacion.
    error: (title: string, description?: ToastDescription) => push('error', title, description),
    // Toast/Cargando (neutral, loader-circle girando) - NO se autodescarta
    // (quedaria sin sentido: debe seguir visible mientras la operacion real
    // sigue en curso). Quien lo dispara es responsable de llamar dismiss()
    // cuando termina, tipicamente seguido de success()/error().
    loading: (title: string, description?: ToastDescription) => push('loading', title, description, false),
    dismiss
  }
}
