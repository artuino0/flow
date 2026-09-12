import 'dotenv/config'
import { spawnSync } from 'node:child_process'
if (!process.env.DATABASE_URL || !process.env.APP_DATABASE_URL) throw new Error('Falta la configuración local de PostgreSQL')
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'test/unit/moduleNavigation.test.ts', 'test/integration/rolePermissions.test.ts', 'test/integration/navigation.test.ts', 'test/integration/moduleEntities.test.ts'], {
  stdio: 'inherit', env: { ...process.env, TEST_POSTGRES_ADMIN_URL: process.env.DATABASE_URL, TEST_POSTGRES_APP_PASSWORD: decodeURIComponent(new URL(process.env.APP_DATABASE_URL).password) }
})
process.exitCode = result.status ?? 1
