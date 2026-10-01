import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'

describe('ERD-142 evaluador protegido', () => {
 it.each(['', '--confirm'])('sin clave nunca llama API: %s', argument => {
  const output = execFileSync(process.execPath, ['scripts/evalAgent.mjs', ...(argument ? [argument] : [])], { encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: '', OPENAI_BASE_URL: 'http://127.0.0.1:1' } })
  expect(output).toContain('No se llamó a la API'); expect(output).toContain('30 casos')
 })
 it('clave sin confirm no llama API ni imprime clave', () => {
  const output = execFileSync(process.execPath, ['scripts/evalAgent.mjs'], { encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: 'CLAVE-NO-IMPRIMIR', OPENAI_BASE_URL: 'http://127.0.0.1:1' } })
  expect(output).toContain('No se llamó a la API'); expect(output).not.toContain('CLAVE-NO-IMPRIMIR')
 })
 it('simulación recorre los 30 casos, juez y resumen sin red', () => {
  const output = execFileSync(process.execPath, ['scripts/evalAgent.mjs', '--simulate'], { encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: '', OPENAI_BASE_URL: 'http://127.0.0.1:1' }, timeout: 30000 })
  expect(output).toContain('| cupos |'); expect(output).toContain('| otra_org |'); expect(output).toContain('judge: gpt-6-luna')
  expect(output).toContain('no miden calidad real'); expect(output).toContain('Tokens entrada/salida')
  expect(output.split('\n').filter(line => /^\| [a-z_]+ \|/.test(line))).toHaveLength(30)
 })
 it.each([{ threshold: '0.9', invalidJudge: '0', status: 1 }, { threshold: '0.4', invalidJudge: '0', status: 0 }, { threshold: '0.4', invalidJudge: '1', status: 1 }])('umbral y juez con fetch simulado: %j', ({ threshold, invalidJudge, status }) => {
  const result = spawnSync(process.execPath, ['--import', './test/fixtures/agentEvalTransport.mjs', 'scripts/evalAgent.mjs', '--confirm', '--threshold', threshold, '--light-input-usd', '1', '--light-output-usd', '2'], {
   encoding: 'utf8', timeout: 30000,
   env: { ...process.env, OPENAI_API_KEY: 'CLAVE-SIMULADA-PRIVADA', OPENAI_BASE_URL: 'http://127.0.0.1:1', AGENT_AI_MODEL: 'gpt-5.4-mini', AGENT_AI_MODEL_HIGH: 'gpt-6-luna', AGENT_EVAL_TEST_INVALID_JUDGE: invalidJudge }
  })
  expect(result.status, result.stderr).toBe(status)
  expect(result.stdout).not.toContain('CLAVE-SIMULADA-PRIVADA')
  expect(result.stdout).toContain('600/300')
  expect(result.stdout).toContain('0.001200')
 })
})
