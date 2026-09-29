import { AsyncLocalStorage } from 'node:async_hooks'
import { useEvent } from 'nitropack/runtime/context'

export interface RecordActor { userId: string | null; roleId: string | null; system?: boolean }

const storage = new AsyncLocalStorage<RecordActor>()

export function currentRecordActor(): RecordActor | undefined {
  const explicit = storage.getStore()
  if (explicit) return explicit
  try {
    const auth = useEvent().context.auth
    return auth ? { userId: auth.sub, roleId: auth.roleId } : undefined
  } catch {
    return undefined
  }
}
export function withRecordActor<T>(actor: RecordActor, fn: () => Promise<T>): Promise<T> { return storage.run(actor, fn) }
export function withSystemRecordAccess<T>(fn: () => Promise<T>): Promise<T> { return storage.run({ userId: null, roleId: null, system: true }, fn) }
