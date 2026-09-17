import 'dotenv/config'
import { spawnSync } from 'node:child_process'

if (!process.env.DATABASE_URL || !process.env.APP_DATABASE_URL) throw new Error('Falta la configuración local de PostgreSQL')
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run',
  'test/integration/triggerAdmin.test.ts', 'test/integration/triggers.test.ts',
  'test/integration/triggerActions.test.ts', 'test/integration/triggerEmailAction.test.ts'], {
  stdio: 'inherit',
  env: { ...process.env, TEST_POSTGRES_ADMIN_URL: process.env.DATABASE_URL, TEST_POSTGRES_APP_PASSWORD: decodeURIComponent(new URL(process.env.APP_DATABASE_URL).password) }
})
process.exitCode = result.status ?? 1
