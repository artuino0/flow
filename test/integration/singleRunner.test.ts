import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb } from '../setup/testDb'

let withSingleRunner: any
let client: any

describe('withSingleRunner', () => {
  let testDb: any

  beforeAll(async () => {
    testDb = await createTestDb()
    process.env.APP_DATABASE_URL = testDb.appUrl
    ;({ withSingleRunner } = await import('../../server/utils/singleRunner'))
    ;({ client } = await import('../../server/db'))
  })

  afterAll(async () => {
    await client.end()
    await testDb.stop()
  })

  it('dos llamadas simultaneas con el mismo nombre -> solo una ejecuta', async () => {
    let executions = 0
    const delay = (ms: number) => new Promise(res => setTimeout(res, ms))
    
    const task = async () => {
      return withSingleRunner('test-lock', async () => {
        executions++
        await delay(50) // hold the lock a bit
        return 'done'
      })
    }

    const [res1, res2] = await Promise.all([task(), task()])

    expect(executions).toBe(1)
    
    const ranCount = (res1.ran ? 1 : 0) + (res2.ran ? 1 : 0)
    expect(ranCount).toBe(1)

    // Despues de soltar el lock, otro puede tomarlo
    const res3 = await task()
    expect(res3.ran).toBe(true)
    expect(executions).toBe(2)
  })

  it('tras un error, el candado queda libre', async () => {
    try {
      await withSingleRunner('test-lock-error', async () => {
        throw new Error('Test error')
      })
    } catch (e) {}
    
    const res = await withSingleRunner('test-lock-error', async () => {
      return 'done'
    })
    
    expect(res.ran).toBe(true)
  })
})
