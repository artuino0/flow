// HU-ERD-22: estado de autenticacion compartido en toda la app. El JWT vive
// en una cookie httpOnly (server/api/auth/login.post.ts) - este composable
// nunca lo toca directamente, solo consulta /api/auth/me para saber quien
// esta logueado.
export interface AuthUser {
  authenticated: boolean
  tenantId: string
  roleId: string | null
  email: string | null
  fullName: string | null
  // HU-ERD-83 (parte 2)
  totpEnabled: boolean
}

// HU-ERD-83 (parte 2): login() ya no siempre abre sesion - si el usuario
// tiene 2FA activo, POST /api/auth/login devuelve un tempToken (nunca una
// cookie) y hace falta un segundo paso (loginWithTotp) con el codigo de la
// app autenticadora. pages/login.vue usa este resultado para decidir si
// mostrar el paso 2.
export interface LoginResult {
  requiresTotp: boolean
  tempToken?: string
}

export function useAuth() {
  const user = useState<AuthUser | null>('auth-user', () => null)

  async function fetchMe(): Promise<AuthUser | null> {
    // En SSR, $fetch a una ruta interna no reenvia automaticamente las
    // cookies de la request original - hay que pasarlas a mano.
    const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
    try {
      user.value = await $fetch<AuthUser>('/api/auth/me', { headers })
    } catch {
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
          await $fetch('/api/auth/refresh', { method: 'POST' })
          user.value = await $fetch<AuthUser>('/api/auth/me')
        } catch {
          user.value = null
        }
      } else {
        user.value = null
      }
    }
    return user.value
  }

  // HU-ERD-35: tenantId es opcional - en modo "dedicated" (APP_MODE) no se le
  // pide "Organizacion" al usuario (pages/login.vue), el backend lo resuelve
  // solo. undefined se omite del body via JSON.stringify.
  //
  // HU-ERD-83 (parte 2): ya no abre sesion incondicionalmente - devuelve
  // requiresTotp para que pages/login.vue decida si mostrar el paso 2.
  async function login(tenantId: string | undefined, email: string, password: string): Promise<LoginResult> {
    const result = await $fetch<{ ok: boolean; requiresTotp: boolean; tempToken?: string }>('/api/auth/login', {
      method: 'POST',
      body: { tenantId, email, password }
    })
    if (result.requiresTotp) {
      return { requiresTotp: true, tempToken: result.tempToken }
    }
    await fetchMe()
    return { requiresTotp: false }
  }

  /** HU-ERD-83 (parte 2): paso 2 del login cuando hay 2FA activo. */
  async function loginWithTotp(tempToken: string, code: string): Promise<void> {
    await $fetch('/api/auth/login/totp', { method: 'POST', body: { tempToken, code } })
    await fetchMe()
  }

  /** HU-ERD-83 (parte 2): renueva el access token via el refresh token (cookie httpOnly aparte). */
  async function refresh(): Promise<void> {
    await $fetch('/api/auth/refresh', { method: 'POST' })
  }

  async function logout(): Promise<void> {
    await $fetch('/api/auth/logout', { method: 'POST' })
    user.value = null
  }

  return { user, fetchMe, login, loginWithTotp, refresh, logout }
}
