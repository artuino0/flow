import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('renderiza sin degradación después de disparar la optimización de TurboFan', () => {
  // Sin plugins, inspector, DB ni red: dispara directamente la causa comprobada.
  const systemEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)))
  const output = execFileSync(process.execPath, ['--allow-natives-syntax', fileURLToPath(new URL('../fixtures/siteRenderOptimization194.cjs', import.meta.url))], {
    timeout: 20000, windowsHide: true, encoding: 'utf8',
    env: { ...systemEnv, NODE_ENV: 'test', APP_DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test' }
  })
  const result = JSON.parse(output.trim())
  expect(result.equal).toBe(true)
  expect(result.markers).toBe(2)
  expect(result.optimizationStatus & 16).toBe(16)
  expect(result.elapsedMs).toBeLessThan(500)
}, 30000)
