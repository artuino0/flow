#!/usr/bin/env node
import 'dotenv/config'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { register } from 'tsx/esm/api'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
register()
const [{ runDesignerGeneration }, { validateBlueprintAgainstSnapshot }] = await Promise.all([
  import('../server/utils/moduleDesigner/generate.ts'),
  import('../server/utils/blueprint/validate.ts')
])

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index < 0) return fallback
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) throw new Error(`${name} requiere un valor`)
  return process.argv[index + 1]
}
const label = option('--label', 'local')
if (!/^[a-z0-9][a-z0-9_-]*$/i.test(label)) throw new Error('--label solo admite letras, números, guiones y guiones bajos')
const limit = Number(option('--limit', '12'))
const delayMs = Number(option('--delay-ms', '5000'))
const retryMs = Number(option('--retry-ms', '15000'))
if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(delayMs) || delayMs < 0 || !Number.isInteger(retryMs) || retryMs < 0) throw new Error('Los parámetros numéricos deben ser enteros no negativos; --limit debe ser positivo')
const simulated = process.argv.includes('--simulate')
const sleep = ms => new Promise(done => setTimeout(done, ms))
const cases = JSON.parse(await readFile(resolve(root, 'data/designer-eval/prompts.json'), 'utf8')).slice(0, limit)
const rawBase = JSON.parse(await readFile(resolve(root, 'data/blueprints/taller-mecanico.json'), 'utf8'))

function workshopSnapshot() {
  const current = structuredClone(rawBase)
  const slugs = new Map(current.modules.flatMap(module => [[module.ref, module.slug], [module.slug, module.slug]]))
  const target = ref => slugs.get(ref) ?? ref
  for (const module of current.modules) {
    module.action = 'extend'
    module.ref = module.slug
    module.snapshot = true
    for (const field of module.fields) {
      const rules = field.validationRules
      if (rules?.relationEntity) rules.relationEntity = target(rules.relationEntity)
      if (rules?.calculation?.sourceEntity) rules.calculation.sourceEntity = target(rules.calculation.sourceEntity)
    }
    for (const line of module.lines ?? []) line.childRef = target(line.childRef)
    for (const rule of module.workflow?.rules ?? []) if (rule.lineEntity) rule.lineEntity = target(rule.lineEntity)
  }
  for (const association of current.associations) {
    association.sourceRef = target(association.sourceRef)
    association.targetRef = target(association.targetRef)
  }
  return current
}

const empty = { version: 1, summary: 'Tenant vacío', modules: [], associations: [] }
const outputDir = resolve(root, 'data/designer-eval/results', label)
await mkdir(outputDir, { recursive: true })
const records = []
let currentCase

async function complete(params) {
  if (simulated) {
    const blueprint = structuredClone(currentCase.current)
    blueprint.summary = `Simulación: ${currentCase.id}`
    blueprint.modules.push({ ref: `eval-${currentCase.id.replaceAll('_', '-')}`, action: 'create', kind: 'hecho', name: `Evaluación ${currentCase.id}`, slug: `eval-${currentCase.id.replaceAll('_', '-')}`, fields: [{ name: 'descripcion', label: 'Descripción', dataType: 'text' }] })
    return { value: { message: 'Simulación', blueprint }, inputTokens: 0, outputTokens: 0, model: 'simulated' }
  }
  const { completeDesignerJson } = await import('../server/utils/aiProvider.ts')
  for (let retry = 0; ; retry++) {
    try { return await completeDesignerJson(params) } catch (error) {
      if (retry >= 3 || !/HTTP 429\b/.test(String(error))) throw error
      await sleep(retryMs * (retry + 1))
    }
  }
}

for (const [index, item] of cases.entries()) {
  const started = performance.now()
  const current = item.base === 'taller' ? workshopSnapshot() : structuredClone(empty)
  currentCase = { ...item, current }
  let generated
  let finalError = ''
  try {
    generated = await runDesignerGeneration({
      current, blueprint: current, instruction: item.description,
      conversation: [{ role: 'user', content: item.description, createdAt: new Date().toISOString() }],
      validate: proposal => validateBlueprintAgainstSnapshot(proposal, current), complete
    })
  } catch (error) { finalError = String(error?.message ?? error) }
  const blueprint = generated?.result?.normalized ?? null
  await writeFile(resolve(outputDir, `${item.id}.json`), JSON.stringify(blueprint ?? generated?.proposal ?? { error: finalError || generated?.errors }, null, 2) + '\n')
  await writeFile(resolve(outputDir, `${item.id}.explanation.md`), `${generated?.explanation ?? ''}\n`)
  const proposed = blueprint?.modules.map(module => {
    const old = current.modules.find(existing => existing.slug === module.slug)
    return { module, fields: module.fields.filter(field => !old?.fields.some(existing => existing.name === field.name)) }
  }).filter(item => item.module.action === 'create' || item.fields.length) ?? []
  records.push({
    id: item.id, base: item.base, valid: Boolean(generated?.valid), firstValid: Boolean(generated?.firstValid),
    repairs: generated?.repairs ?? 0, merges: generated?.result?.merges.length ?? 0,
    errors: generated?.errors.map(error => `${error.path}: ${error.message}`).join('; ') || finalError,
    modules: proposed.length, fields: proposed.reduce((sum, item) => sum + item.fields.length, 0),
    moduleNames: proposed.map(item => item.module.name).join(', '),
    fieldNames: proposed.flatMap(item => item.fields.map(field => `${item.module.slug}.${field.name}`)).join(', '),
    inputTokens: generated?.usage.inputTokens ?? 0, outputTokens: generated?.usage.outputTokens ?? 0,
    model: generated?.usage.model ?? '', elapsedMs: Math.round(performance.now() - started)
  })
  console.log(`${index + 1}/${cases.length} ${item.id}: ${generated?.valid ? 'válido' : 'inválido'}`)
  if (index < cases.length - 1) await sleep(delayMs)
}

const safe = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
const totals = records.reduce((sum, row) => {
  for (const key of ['repairs', 'merges', 'modules', 'fields', 'inputTokens', 'outputTokens', 'elapsedMs']) sum[key] += row[key]
  sum.valid += Number(row.valid)
  sum.firstValid += Number(row.firstValid)
  return sum
}, { valid: 0, firstValid: 0, repairs: 0, merges: 0, modules: 0, fields: 0, inputTokens: 0, outputTokens: 0, elapsedMs: 0 })
const lines = [
  `# Evaluación del diseñador: ${label}`,
  '',
  `Casos: ${records.length}. Válidos: ${totals.valid}. Válidos a la primera: ${totals.firstValid}. Autorreparaciones: ${totals.repairs}. Fusiones: ${totals.merges}. Módulos: ${totals.modules}. Campos: ${totals.fields}. Tokens entrada/salida: ${totals.inputTokens}/${totals.outputTokens}. Tiempo total: ${totals.elapsedMs} ms.`,
  '',
  '| Caso | Base | Válido a la primera | Autorreparaciones | Fusiones | Errores finales | Módulos propuestos | Campos propuestos | Tokens entrada | Tokens salida | Tiempo ms | Modelo |',
  '| --- | --- | --- | ---: | ---: | --- | --- | --- | ---: | ---: | ---: | --- |',
  ...records.map(row => `| ${row.id} | ${row.base} | ${row.firstValid ? 'sí' : 'no'} | ${row.repairs} | ${row.merges} | ${safe(row.errors || '—')} | ${row.modules}: ${safe(row.moduleNames || '—')} | ${row.fields}: ${safe(row.fieldNames || '—')} | ${row.inputTokens} | ${row.outputTokens} | ${row.elapsedMs} | ${safe(row.model)} |`),
  ''
]
await writeFile(resolve(outputDir, 'summary.md'), lines.join('\n'))
if (totals.valid !== records.length) process.exitCode = 1
