import { describe, expect, it } from 'vitest'
import { classifyObservabilityError } from '../../server/utils/observabilityError'

describe('observability error classification', () => {
  it.each([401, 403, 404, 409])('classifies HTTP %i as a warning', statusCode => {
    expect(classifyObservabilityError({ statusCode })).toBe('warning')
  })

  it('classifies any HTTP error below 500 as a warning', () => {
    expect(classifyObservabilityError({ statusCode: 422 })).toBe('warning')
  })

  it('keeps 500 and errors without statusCode at error level', () => {
    expect(classifyObservabilityError({ statusCode: 500 })).toBe('error')
    expect(classifyObservabilityError(new Error('unexpected'))).toBe('error')
  })
})
