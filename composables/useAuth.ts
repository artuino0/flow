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
}

export function useAuth() {
  const user = useState<AuthUser | null>('auth-user', () => null)

  async function fetchMe(): Promise<AuthUser | null> {
    try {
      // En SSR, $fetch a una ruta interna no reenvia automaticamente las
      // cookies de la request original - hay que pasarlas a mano.
      const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
      user.value = await $fetch<AuthUser>('/api/auth/me', { headers })
    } catch {
      user.value = null
    }
    return user.value
  }

  // HU-ERD-35: tenantId es opcional - en modo "dedicated" (APP_MODE) no se le
  // pide "Organizacion" al usuario (pages/login.vue), el backend lo resuelve
  // solo. undefined se omite del body via JSON.stringify.
  async function login(tenantId: string | undefined, email: string, password: string): Promise<void> {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: { tenantId, email, password }
    })
    await fetchMe()
  }

  async function logout(): Promise<void> {
    await $fetch('/api/auth/logout', { method: 'POST' })
    user.value = null
  }

  return { user, fetchMe, login, logout }
}
