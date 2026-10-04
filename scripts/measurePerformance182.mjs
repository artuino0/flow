import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
const root = process.cwd()
if (!root.endsWith(`${path.sep}frontback-ci${path.sep}erd182-clean`)) throw new Error('Ejecutar solo en frontback-ci/erd182-clean')
const stage = process.argv[2] ?? 'after'
if (!['before', 'after'].includes(stage)) throw new Error('Etapa inválida')
if (!process.env.TEST_POSTGRES_ADMIN_URL || !['localhost', '127.0.0.1'].includes(new URL(process.env.TEST_POSTGRES_ADMIN_URL).hostname)) throw new Error('Se requiere PostgreSQL local de pruebas')
if (existsSync(path.join(root, '.env'))) throw new Error('La copia no debe tener .env')
const child = spawn(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'test/integration/performance182.test.ts', '--maxWorkers=1', ...(stage==='before' ? ['-t','mide handlers reales'] : [])], {
  cwd: root, env: { ...process.env, PERF182_STAGE: stage, PERF182_LATENCY_MS: '60' }, stdio: 'inherit', windowsHide: true
})
child.on('exit', code => { process.exitCode = code ?? 1 })
