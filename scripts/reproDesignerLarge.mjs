import 'dotenv/config'
import { readFile, writeFile } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { register } from 'tsx/esm/api'
if (!process.argv.includes('--confirm')) throw new Error('Se requiere --confirm para llamadas reales')
for (const key of ['APP_DATABASE_URL', 'DATABASE_URL']) if (process.env[key]) {
  const url = new URL(process.env[key])
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '5433') throw new Error('Solo se admite la base local en :5433')
}
if (process.env.AI_PROVIDER !== 'openai') throw new Error('Esta evaluación requiere OpenAI local')
register()
const [{ db, client }, { tenants }, { eq }, { exportBlueprint }, { validateBlueprint }, { blueprintSchema }, { runDesignerGeneration }, { completeDesignerJson }] = await Promise.all([
  import('../server/db/index.ts'), import('../server/db/schema.ts'), import('drizzle-orm'), import('../server/utils/blueprint/export.ts'), import('../server/utils/blueprint/validate.ts'), import('../server/utils/blueprint/schema.ts'), import('../server/utils/moduleDesigner/generate.ts'), import('../server/utils/aiProvider.ts')
])
export const rows = []
const bug149 = process.argv.includes('--bug149')
const maxCalls = bug149 ? 20 : 40
const ledgerPath = `C:/desarrollo/ERP-Dinamico/DOCS/tareas/sol-${bug149 ? 'BUG-ERD-149' : 'HU-ERD-148'}-calls.json`
export let calls = 0
try { calls = Number(JSON.parse(readFileSync(ledgerPath, 'utf8')).calls) } catch (error) { if (error.code !== 'ENOENT') throw error }
if (!Number.isInteger(calls) || calls < 0 || calls > maxCalls) throw new Error('Contador de llamadas inválido')
const initialCalls = calls
const originalFetch = globalThis.fetch
// Cuenta también reintentos HTTP internos. El tope es de solicitudes, no de generaciones.
globalThis.fetch = (...args) => {
  const url = new URL(String(args[0]))
  if (url.hostname !== 'api.openai.com') throw new Error('Solo se admite OpenAI')
  if (calls >= maxCalls) throw new Error(`Tope de ${maxCalls} llamadas`)
  if (process.argv.includes('--one-call') && calls - initialCalls >= 1) throw new Error('Solo se autoriza una llamada HTTP en esta comprobación')
  if (bug149 && calls - initialCalls >= (process.argv.includes('--diagnose') ? 6 : 12)) throw new Error('Tope de llamadas de esta fase')
  writeFileSync(ledgerPath, JSON.stringify({ calls: ++calls }))
  return originalFetch(...args)
}
try {
  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, 'dynamic-data'))
  if (!tenant) throw new Error('Tenant local no encontrado')
  const current = await exportBlueprint(tenant.id)
  if (current.modules.length) throw new Error('Se esperaba tenant vacío')
  const crm = await readFile('C:/desarrollo/ERP-Dinamico/DOCS/tareas/prompt-crm-dynamicdata.txt', 'utf8')
  const large = process.argv.includes('--large')
  const industries = ['Restaurante con inventario y reservas', 'Clínica con citas y expediente', 'Agencia de viajes', 'Despacho contable', 'Taller de vehículos', 'Distribuidora mayorista', 'Escuela', 'Constructora', 'Hotel', 'Inmobiliaria', 'Centro de estética']
  const cases = large ? [{ id: 'crm', prompt: crm }, ...industries.map((name, i) => ({ id: `giro-${i + 1}`, prompt: `Diseña todo el negocio: ${name}. Incluye seis catálogos reutilizables de clientes, personal, servicios, categorías, ubicaciones y proveedores adaptados al giro; tres módulos principales conectados con entre 12 y 20 campos cada uno: operaciones, seguimiento y cobros. Agrega identificadores, contacto, fechas, responsable Usuario, importes, descuentos, estatus, partidas con cantidad y precio, total calculado y acumulado de cobros, flujo de estados y reglas de campos obligatorios. Necesito avisos por tiempo, vistas por responsable y dashboard. Entrega la estructura completa y explica cualquier parte que no puedas configurar.` }))] : Array.from({ length: 3 }, (_, i) => ({ id: `crm-${i + 1}`, prompt: crm }))
  const selectedCase = process.argv.find(arg => arg.startsWith('--case='))?.slice(7)
  const selected = (bug149 ? (process.argv.includes('--diagnose') ? [{ id: 'diagnostico', prompt: crm }] : [...Array.from({ length: 3 }, (_, i) => ({ id: `crm-${i + 1}`, prompt: crm })), ...cases.slice(1, 4)]) : cases).filter(item => !selectedCase || item.id === selectedCase)
  for (const item of selected) {
    const start = performance.now()
    let attempt = 0
    try {
      const rawAnswers = []
      const generated = await runDesignerGeneration({ current, blueprint: current, instruction: item.prompt, conversation: [], complete: async params => {
        const completion = await completeDesignerJson(params)
        if (bug149) rawAnswers.push(completion.value)
        return completion
      }, validate: async proposal => {
        attempt++
        const shape = blueprintSchema.safeParse(proposal)
        if (!shape.success && !large) for (const issue of shape.error.issues) {
          const module = proposal?.modules?.[issue.path[1]]
          const field = module?.fields?.[issue.path[3]]
          // Diagnóstico local: identificadores técnicos y Zod original, nunca datos de registros ni el plano.
          console.log(JSON.stringify({ case: item.id, attempt, path: issue.path, code: issue.code === 'custom' ? issue.params?.ruleCode ?? issue.code : issue.code, dataType: field?.dataType, moduleSlug: module?.slug, fieldName: field?.name, ruleKey: issue.path[5] ?? (issue.code === 'custom' ? issue.params?.ruleKeys?.[0] : null), ruleKeys: issue.code === 'custom' ? issue.params?.ruleKeys : undefined, originalMessage: issue.message }))
        }
        return validateBlueprint(tenant.id, proposal)
      } })
      rows.push({ case: item.id, valid: generated.valid && !generated.result?.errors.length, warnings: generated.warnings.length, degradations: generated.warnings.filter(warning => /campo simple|quité la regla|omití el campo/.test(warning)).length, errors: generated.errors.map(e => ({ path: e.path, code: e.code })), inputTokens: generated.usage.inputTokens, outputTokens: generated.usage.outputTokens, elapsedMs: Math.round(performance.now() - start), calls, ...(bug149 ? { instruction: item.prompt, rawAnswers, blueprint: generated.result?.normalized, warningTexts: generated.warnings, explanation: generated.explanation } : {}) })
    } catch { rows.push({ case: item.id, valid: false, error: 'Proveedor o ejecución no disponible', elapsedMs: Math.round(performance.now() - start), calls }) }
    console.log(JSON.stringify(bug149 ? { case: rows.at(-1).case, valid: rows.at(-1).valid, calls, warnings: rows.at(-1).warnings } : rows.at(-1)))
  }
  console.table(rows.map(({ errors, rawAnswers, blueprint, instruction, warningTexts, explanation, ...row }) => ({ ...row, errors: errors?.length ?? 0 })))
  await writeFile(`C:/desarrollo/ERP-Dinamico/DOCS/tareas/sol-${bug149 ? 'BUG-ERD-149' : 'HU-ERD-148'}-${selectedCase ? `check-${selectedCase}` : process.argv.includes('--diagnose') ? 'before' : large ? 'after' : 'repro'}.json`, JSON.stringify({ rows, calls: calls - initialCalls }, null, 2))
  console.log(JSON.stringify({ applicablePercent: 100 * rows.filter(r => r.valid).length / rows.length, calls }))
} finally { globalThis.fetch = originalFetch; await client.end() }
