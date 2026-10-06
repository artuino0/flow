import { AsyncLocalStorage } from 'node:async_hooks'

// Solo código interno puede abrir estos ámbitos; nunca cabeceras/body/JWT.
const lifecycleAccess = new AsyncLocalStorage<boolean>()
export const accountRecoveryAccess = () => lifecycleAccess.getStore() === true
export function withAccountRecovery<T>(fn: () => T): T { return lifecycleAccess.run(true, fn) }
