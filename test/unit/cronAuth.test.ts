import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requireCronSecret } from '../../server/utils/cronAuth'
import { H3Event, H3Error } from 'h3'

describe('requireCronSecret', () => {
  let eventMock: any

  beforeEach(() => {
    eventMock = {
      node: { req: { headers: {} } }
    }
    vi.unstubAllGlobals()
  })

  it('arroja 503 si CRON_SECRET no esta configurado', () => {
    delete process.env.CRON_SECRET
    try {
      requireCronSecret(eventMock as H3Event)
      expect.fail('debio arrojar error')
    } catch (e: any) {
      expect(e.statusCode).toBe(503)
    }
  })

  it('arroja 401 si no hay token o es invalido', () => {
    process.env.CRON_SECRET = 'secreto_super_seguro'
    try {
      requireCronSecret(eventMock as H3Event)
      expect.fail('debio arrojar error')
    } catch (e: any) {
      expect(e.statusCode).toBe(401)
    }

    eventMock.node.req.headers.authorization = 'Bearer secreto_equivocado'
    try {
      requireCronSecret(eventMock as H3Event)
      expect.fail('debio arrojar error')
    } catch (e: any) {
      expect(e.statusCode).toBe(401)
    }
  })

  it('no arroja error si el token es correcto', () => {
    process.env.CRON_SECRET = 'secreto_super_seguro'
    eventMock.node.req.headers.authorization = 'Bearer secreto_super_seguro'
    expect(() => requireCronSecret(eventMock as H3Event)).not.toThrow()
  })
})
