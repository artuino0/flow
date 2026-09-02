// HU-ERD-83 (parte 2): sesion "deslizante" con aviso de inactividad, pedido
// explicito del usuario en esta HU (sin mock en el .pen, revisado antes de
// construir - ver [[pencil-antes-de-frontend]]): mientras haya actividad
// real (mouse/teclado/scroll/touch), el access token se renueva solo de
// fondo via POST /api/auth/refresh (throttleado, no en cada evento). A los
// 60s SIN actividad aparece un modal de advertencia con una cuenta regresiva
// de 60s - si nadie confirma "Seguir conectado" antes de que llegue a 0, se
// cierra la sesion. Una vez que el modal aparece, SOLO el boton confirma (no
// alcanza con mover el mouse por arriba del modal) - evita que un roce
// accidental del cursor mantenga viva una sesion realmente abandonada, mismo
// criterio que usan flujos de este tipo en banca online.
//
// Solo se monta desde layouts/default.vue (layout autenticado) - login.vue
// usa `layout: false`, asi que no hay sesion que cuidar ahi.

const IDLE_BEFORE_WARNING_MS = 60 * 1000
const WARNING_DURATION_SECONDS = 60
const REFRESH_THROTTLE_MS = 5 * 60 * 1000
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const

export function useIdleTimeout(onTimeout: () => void | Promise<void>) {
  const { refresh } = useAuth()

  const showWarning = ref(false)
  const countdown = ref(WARNING_DURATION_SECONDS)

  let lastActivity = Date.now()
  let lastRefresh = Date.now()
  let tickHandle: ReturnType<typeof setInterval> | null = null

  function markActivity() {
    lastActivity = Date.now()
  }

  function silentRefresh() {
    lastRefresh = Date.now()
    // Best-effort: si falla (ej. refresh token ya vencido), no hace falta
    // reaccionar aca - la proxima llamada real a la API va a devolver 401 y
    // el flujo normal de la app (middleware/auth.global.ts) se encarga.
    refresh().catch(() => {})
  }

  function tick() {
    const now = Date.now()

    if (showWarning.value) {
      countdown.value -= 1
      if (countdown.value <= 0) {
        stop()
        void onTimeout()
      }
      return
    }

    if (now - lastActivity >= IDLE_BEFORE_WARNING_MS) {
      showWarning.value = true
      countdown.value = WARNING_DURATION_SECONDS
      return
    }

    if (now - lastRefresh >= REFRESH_THROTTLE_MS) {
      silentRefresh()
    }
  }

  function confirmActive() {
    markActivity()
    showWarning.value = false
    countdown.value = WARNING_DURATION_SECONDS
    silentRefresh()
  }

  function stop() {
    if (tickHandle !== null) {
      clearInterval(tickHandle)
      tickHandle = null
    }
    if (import.meta.client) {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, markActivity)
    }
  }

  onMounted(() => {
    if (import.meta.server) return
    lastActivity = Date.now()
    lastRefresh = Date.now()
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, markActivity, { passive: true })
    tickHandle = setInterval(tick, 1000)
  })

  onUnmounted(stop)

  return { showWarning, countdown, confirmActive }
}
