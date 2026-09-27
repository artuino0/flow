import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const label = `test-${process.pid}`
const output = resolve(process.cwd(), 'data/designer-eval/results', label)
afterAll(() => rmSync(output, { recursive: true, force: true }))

describe('evaluador sin base de datos', () => {
  it('produce planos y summary.md en modo simulado aun con URL de base inválida', () => {
    execFileSync(process.execPath, ['scripts/evalDesigner.mjs', '--simulate', '--label', label, '--limit', '7', '--delay-ms', '0'], {
      cwd: process.cwd(), env: { ...process.env, APP_DATABASE_URL: 'postgres://invalid:invalid@127.0.0.1:1/invalid' }, timeout: 30_000
    })
    const summary = readFileSync(resolve(output, 'summary.md'), 'utf8')
    expect(summary).toContain('Casos: 7. Válidos: 7.')
    expect(summary).toContain('| renta | taller | sí |')
    expect(JSON.parse(readFileSync(resolve(output, 'renta.json'), 'utf8')).modules).toHaveLength(7)
  })
})
