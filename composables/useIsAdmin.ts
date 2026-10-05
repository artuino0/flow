// El servidor calcula la señal con el mismo guard que protege la administración.
export function useIsAdmin() {
  const { user } = useAuth()
  return { data: computed(() => user.value?.isAdmin ?? false), pending: computed(() => false), status: computed<'idle' | 'pending' | 'success' | 'error'>(() => 'success') }
}
