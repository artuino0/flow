import { describe, expect, it } from 'vitest'
import { realtimeReconnectDelay, realtimeRefreshRequiresSession, shouldConnectRealtime } from '../../utils/realtimeRetry'

describe('realtime refresh retry policy', () => {
  it('pauses reconnects when refresh returns 401 or 403', () => {
    expect(realtimeRefreshRequiresSession({ statusCode: 401 })).toBe(true)
    expect(realtimeRefreshRequiresSession({ statusCode: 403 })).toBe(true)
    expect(realtimeRefreshRequiresSession(new Error('network'))).toBe(false)
    expect(realtimeRefreshRequiresSession({ statusCode: 500 })).toBe(false)
  })

  it('retries transport errors with increasing backoff capped at 30 seconds', () => {
    expect(realtimeReconnectDelay(0, 0.5)).toBe(1_000)
    expect(realtimeReconnectDelay(1, 0.5)).toBe(2_000)
    expect(realtimeReconnectDelay(20, 1)).toBe(30_000)
  })

  it('allows a new connection attempt when the session is confirmed again', () => {
    let sessionRequired = true
    expect(shouldConnectRealtime(false, sessionRequired)).toBe(false)
    const resumeSession = () => { sessionRequired = false }
    resumeSession()
    expect(shouldConnectRealtime(false, sessionRequired)).toBe(true)
  })
})
