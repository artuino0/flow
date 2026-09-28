import { AsyncLocalStorage } from 'node:async_hooks'

export interface RecordActor { userId: string | null; roleId: string | null }

const storage = new AsyncLocalStorage<RecordActor>()

export function setRecordActor(actor: RecordActor): void { storage.enterWith(actor) }
export function currentRecordActor(): RecordActor | undefined { return storage.getStore() }
export function withRecordActor<T>(actor: RecordActor, fn: () => Promise<T>): Promise<T> { return storage.run(actor, fn) }
