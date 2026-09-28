#!/usr/bin/env node
import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { register } from 'tsx/esm/api'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
register()
const [{ runDesignerGeneration }, { validateBlueprintAgainstSnapshot }] = await Promise.all([
  import('../server/utils/moduleDesigner/generate.ts'),
  import('../server/utils/blueprint/validate.ts')
])

const clinic = JSON.parse(await readFile(resolve(root, 'data/designer-eval/results/luna-usuarios/clinica.json'), 'utf8'))
const tenant = { version: 1, summary: 'Tenant vacío', modules: [], associations: [] }
const instructions = [
  'Agrega a Citas el campo motivo_reprogramacion de tipo text, etiqueta Motivo de reprogramación. No cambies otros elementos.',
  'Cambia el tipo del campo motivo de Citas de text a select con opciones consulta, seguimiento y urgencia. Conserva los demás campos.',
  'Agrega el estado reprogramada al flujo de Citas, con una transición desde programada; agrega también la opción al campo estado. Conserva los demás estados y transiciones.'
]

for (const [index, instruction] of instructions.entries()) {
  if (process.argv.includes('--instruction') && Number(process.argv[process.argv.indexOf('--instruction') + 1]) !== index + 1) continue
  for (const mode of ['full', 'patch']) {
    const started = performance.now()
    try {
      const generated = await runDesignerGeneration({
        current: tenant, blueprint: structuredClone(clinic), instruction, mode,
        contextMode: mode === 'full' ? 'full' : 'compact',
        conversation: [
          { role: 'assistant', content: 'Preparé la estructura de clínica.', createdAt: new Date().toISOString() },
          { role: 'user', content: instruction, createdAt: new Date().toISOString() }
        ],
        validate: proposal => validateBlueprintAgainstSnapshot(proposal, tenant)
      })
      console.log(JSON.stringify({ instruction: index + 1, mode, valid: generated.valid, firstValid: generated.firstValid,
        repairs: generated.repairs, inputTokens: generated.usage.inputTokens, outputTokens: generated.usage.outputTokens,
        elapsedMs: Math.round(performance.now() - started), model: generated.usage.model,
        errors: generated.errors.map(error => `${error.path}: ${error.message}`) }))
    } catch (error) {
      console.log(JSON.stringify({ instruction: index + 1, mode, valid: false, elapsedMs: Math.round(performance.now() - started), error: String(error?.message ?? error) }))
    }
  }
}
