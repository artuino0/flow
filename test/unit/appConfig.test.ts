import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getAppMode, isFeatureEnabled } from '../../server/utils/appConfig'

// HU-ERD-35: getAppMode/isFeatureEnabled son funciones puras sobre
// process.env - unit test sin DB ni servidor, mismo criterio que
// buildFieldType (HU-ERD-17/29).

const ENV_KEYS = ['APP_MODE', 'FEATURE_DASHBOARD', 'FEATURE_FOO'] as const
const originalEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key]
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
})

describe('getAppMode', () => {
  it('default "saas" si APP_MODE no esta seteado', () => {
    delete process.env.APP_MODE
    expect(getAppMode()).toBe('saas')
  })

  it('"dedicated" solo con el valor exacto "dedicated"', () => {
    process.env.APP_MODE = 'dedicated'
    expect(getAppMode()).toBe('dedicated')
  })

  it('cualquier otro valor cae a "saas" (no "dedicated" a medias)', () => {
    process.env.APP_MODE = 'Dedicated'
    expect(getAppMode()).toBe('saas')
    process.env.APP_MODE = 'algo-random'
    expect(getAppMode()).toBe('saas')
  })
})

describe('isFeatureEnabled', () => {
  it('habilitado por default si la variable no esta seteada (un flag ausente nunca apaga nada)', () => {
    delete process.env.FEATURE_FOO
    expect(isFeatureEnabled('foo')).toBe(true)
  })

  it('"false" y "0" lo apagan, case-insensitive', () => {
    process.env.FEATURE_FOO = 'false'
    expect(isFeatureEnabled('foo')).toBe(false)
    process.env.FEATURE_FOO = 'FALSE'
    expect(isFeatureEnabled('foo')).toBe(false)
    process.env.FEATURE_FOO = '0'
    expect(isFeatureEnabled('foo')).toBe(false)
  })

  it('"true", vacio, o cualquier otro valor lo dejan habilitado', () => {
    process.env.FEATURE_FOO = 'true'
    expect(isFeatureEnabled('foo')).toBe(true)
    process.env.FEATURE_FOO = ''
    expect(isFeatureEnabled('foo')).toBe(true)
    process.env.FEATURE_FOO = 'yes'
    expect(isFeatureEnabled('foo')).toBe(true)
  })

  it('el nombre se normaliza a mayusculas con el prefijo FEATURE_', () => {
    process.env.FEATURE_DASHBOARD = 'false'
    expect(isFeatureEnabled('dashboard')).toBe(false)
    expect(isFeatureEnabled('DASHBOARD')).toBe(false)
    expect(isFeatureEnabled('DaShBoArD')).toBe(false)
  })
})
