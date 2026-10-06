// HU-ERD-22: estado de autenticacion compartido en toda la app. El JWT vive
// en una cookie httpOnly (server/api/auth/login.post.ts) - este composable
// nunca lo toca directamente, solo consulta /api/auth/me para saber quien
// esta logueado.
export interface AuthUser {
  id: string
  isAdmin: boolean
  isPlatformAdmin?: boolean
  accountLifecycle?: import('~/utils/accountLifecycle').AccountLifecycle
  sessionId?: string
  tenantName?: string
  // Dominio fiscal fijo (DOCS/HU_Timbrado_CFDI_PAC.md): país de la
  // organización — la nav muestra "Facturación" solo si es 'MX'.
  country?: string
  idleTimeoutMinutes?: number
  idleWarningMinutes?: number
  authenticated: boolean
  emailVerified: boolean
  onboardingStatus: 'email_pending' | 'plan_pending' | 'checkout_pending' | 'complete'
  tenantId: string
  roleId: string | null
  email: string | null
  fullName: string | null
  phone?: string | null
  jobTitle?: string | null
  timezone?: string | null
  // HU-ERD-83 (parte 2)
  totpEnabled: boolean
}

// HU-ERD-83 (parte 2): login() ya no siempre abre sesion - si el usuario
// tiene 2FA activo, POST /api/auth/login devuelve un tempToken (nunca una
// cookie) y hace falta un segundo paso (loginWithTotp) con el codigo de la
// app autenticadora. pages/login.vue usa este resultado para decidir si
// mostrar el paso 2.
//
// HU multi-organizacion (2026-09-04): ademas de requiresTotp, ahora existe
// requiresOrgSelection - la persona (email+password, y el codigo TOTP si
// aplica) ya se validó, pero pertenece a MAS de una organización y hace
// falta un paso extra (pendingToken + organizations) para elegir con cual
// entrar. Nunca se piden ambas cosas a la vez en el MISMO resultado (el
// backend resuelve TOTP primero, y recien despues - con la identidad ya
// confirmada - decide si hay que elegir organización), pero el tipo cubre
// las tres formas posibles de la respuesta (login directo, pedir TOTP, pedir
// organización).
export interface OrganizationOption {
  tenantId: string
  tenantName: string
}

export interface LoginResult {
  requiresTotp: boolean
  requiresOrgSelection: boolean
  tempToken?: string
  pendingToken?: string
  organizations?: OrganizationOption[]
}

export function useAuth() {
  const user = useState<AuthUser | null>('auth-user', () => null)
  const nuxtApp = useNuxtApp()
  const flights = authFlights(nuxtApp)
  const renewedAt = useState('auth-renewed-at', () => 0)
  const generation = useState('auth-generation', () => 0)
  const navigationPending = useState('auth-navigation-pending', () => false)

  function acceptUser(value: AuthUser, navigating = false) {
    generation.value++
    if (navigating) navigationPending.value = true
    user.value = value
    renewedAt.value = Date.now()
    if (import.meta.client) {
      nuxtApp.runWithContext(() => {
        if (!['suspended', 'pending_deletion'].includes(value.accountLifecycle?.phase ?? '')) useRealtime().resumeSession()
        void preloadRouteComponents('/').catch(() => undefined)
      })
    }
  }

  async function fetchMe(): Promise<AuthUser | null> {
    if (flights.me) return flights.me
    flights.me = loadMe().finally(() => { flights.me = undefined })
    return flights.me
  }

  async function loadMe(): Promise<AuthUser | null> {
    const started = generation.value
    // En SSR, $fetch a una ruta interna no reenvia automaticamente las
    // cookies de la request original - hay que pasarlas a mano.
    const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
    try {
      const profile = await $fetch<AuthUser>('/api/auth/me', { headers })
      if (generation.value === started) user.value = profile
    } catch {
      if (generation.value !== started) return user.value
      // HU-ERD-83 (parte 2): el access token (15 min) puede haber expirado
      // aunque el refresh token (7 dias) siga vivo - antes de dar la sesion
      // por perdida, se intenta UNA renovacion silenciosa y se reintenta.
      // Solo del lado del cliente: un refresh disparado durante SSR setea
      // cookies en la respuesta interna del fetch a si mismo, no en la
      // respuesta real que llega al navegador - relayarlo correctamente
      // queda fuera de esta entrega (limite conocido, ver CHANGELOG). En la
      // practica el modal de inactividad (composables/useIdleTimeout.ts)
      // cierra sesion mucho antes de que el access token llegue a expirar
      // solo, asi que este caso (F5 justo en la ventana de 1 a 15 min de
      // inactividad) es poco frecuente.
      if (import.meta.client) {
        try {
          await refresh()
        } catch {
          user.value = null
        }
      } else {
        user.value = null
      }
    }
    if (user.value?.authenticated && !['suspended', 'pending_deletion'].includes(user.value.accountLifecycle?.phase ?? '') && import.meta.client) nuxtApp.runWithContext(() => useRealtime().resumeSession())
    return user.value
  }

  // HU multi-organizacion (2026-09-04): ya no manda tenantId (el pedido
  // explicito del usuario fue justamente que el login NO lo pida a fuerza en
  // el primer paso - server/api/auth/login.post.ts resuelve la organización
  // solo, despues de validar la identidad). requiresOrgSelection=true cuando
  // la persona tiene mas de una organización activa - pages/login.vue
  // decide entonces si mostrar el paso 2 (TOTP) o el paso de elegir
  // organización, segun cual venga en true.
  async function login(email: string, password: string): Promise<LoginResult> {
    const result = await $fetch<{
      ok: boolean
      requiresTotp: boolean
      tempToken?: string
      requiresOrgSelection?: boolean
      pendingToken?: string
      organizations?: OrganizationOption[]
      user: AuthUser
    }>('/api/auth/login', {
      method: 'POST',
      body: { email, password }
    })
    if (result.requiresTotp) {
      return { requiresTotp: true, requiresOrgSelection: false, tempToken: result.tempToken }
    }
    if (result.requiresOrgSelection) {
      return { requiresTotp: false, requiresOrgSelection: true, pendingToken: result.pendingToken, organizations: result.organizations }
    }
    acceptUser(result.user, true)
    return { requiresTotp: false, requiresOrgSelection: false }
  }

  /**
   * HU-ERD-83 (parte 2): paso 2 del login cuando hay 2FA activo.
   *
   * HU multi-organizacion (2026-09-04): un codigo TOTP valido ya no abre
   * sesion incondicionalmente - puede devolver requiresOrgSelection igual
   * que login(), si la persona pertenece a mas de una organización.
   */
  async function loginWithTotp(tempToken: string, code: string): Promise<LoginResult> {
    const result = await $fetch<{ ok: boolean; requiresOrgSelection?: boolean; pendingToken?: string; organizations?: OrganizationOption[]; user: AuthUser }>(
      '/api/auth/login/totp',
      { method: 'POST', body: { tempToken, code } }
    )
    if (result.requiresOrgSelection) {
      return { requiresTotp: false, requiresOrgSelection: true, pendingToken: result.pendingToken, organizations: result.organizations }
    }
    acceptUser(result.user, true)
    return { requiresTotp: false, requiresOrgSelection: false }
  }

  /**
   * HU multi-organizacion (2026-09-04): paso final del login cuando la
   * persona pertenece a mas de una organización (Screen "Elegir
   * organización", nueva - no hay diseño Pencil propio, ver el comentario en
   * pages/login.vue). No vuelve a pedir contraseña ni codigo TOTP - el
   * pendingToken ya prueba que se validaron.
   */
  async function selectOrganization(pendingToken: string, tenantId: string): Promise<void> {
    const result = await $fetch<{ user: AuthUser }>('/api/auth/login/select-org', { method: 'POST', body: { pendingToken, tenantId } })
    acceptUser(result.user, true)
  }

  /** HU-ERD-83 (parte 2): renueva el access token via el refresh token (cookie httpOnly aparte). */
  async function refresh(): Promise<void> {
    if (flights.refresh) return flights.refresh
    const identity = user.value
    flights.refresh = $fetch<{ user: AuthUser }>('/api/auth/refresh', { method: 'POST' }).then(result => {
      if (user.value === identity) acceptUser(result.user)
    }).finally(() => { flights.refresh = undefined })
    return flights.refresh
  }

  async function logout(): Promise<void> {
    await $fetch('/api/auth/logout', { method: 'POST' })
    generation.value++
    navigationPending.value = false
    user.value = null
    useState('flow-app-access-cache').value = null
    useState('license-status-cache').value = null
    clearNuxtData()
  }

  return { user, renewedAt, fetchMe, login, loginWithTotp, selectOrganization, refresh, logout }
}

// Promesas fuera del payload serializado y aisladas por aplicación/petición SSR.
const pendingAuth = new WeakMap<object, { me?: Promise<AuthUser | null>; refresh?: Promise<void> }>()
function authFlights(app: object) {
  if (!pendingAuth.has(app)) pendingAuth.set(app, {})
  return pendingAuth.get(app)!
}

