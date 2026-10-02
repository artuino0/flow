import { describe, expect, it, vi } from 'vitest'
import { designerCoverageWarnings, designerOmissionsSchema, designerRequestedItems, normalizeCoverageName, extractDesignerOmissions } from '../../server/utils/moduleDesigner/coverage'
import { runDesignerGeneration } from '../../server/utils/moduleDesigner/generate'
import { validateBlueprintAgainstSnapshot } from '../../server/utils/blueprint/validate'
import { limitDesignerExplanation } from '../../server/utils/moduleDesigner/explanation'
import { designerChatEntries } from '../../utils/designerChat'
import { readFileSync } from 'node:fs'
import type { Blueprint } from '../../server/utils/blueprint/schema'

const empty: Blueprint = { version: 1, summary: 'Vacío', modules: [], associations: [] }
const design = (): Blueprint => ({ ...empty, modules: [{ ref: 'prospectos', slug: 'prospectos', name: 'Prospectos', kind: 'hecho', action: 'create', icon: 'Users', fields: [{ name: 'total_seguimientos', label: 'Total de seguimientos', dataType: 'number' }] }] })
const instruction = 'En Prospectos: total de seguimientos, fecha del último seguimiento y días\n  sin contacto (calculados).'
const run = (answer: object, request = instruction, base = empty) => runDesignerGeneration({ current: empty, blueprint: base, instruction: request, conversation: [], complete: vi.fn(async () => ({ value: answer, inputTokens: 1, outputTokens: 1, model: 'simulado' })), validate: proposal => validateBlueprintAgainstSnapshot(proposal, empty) })

describe('ERD-149: omisiones y cobertura', () => {
  it('avisa por cálculo simple y nombres ausentes aun sin omissions', async () => {
    const result = await run({ message: 'CRM', blueprint: design() })
    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(3)
    expect(result.warnings[0]).toContain('sin cálculo')
    expect(result.warnings[2]).toContain('no quedó en el plano')
    expect(designerOmissionsSchema.parse(undefined)).toEqual([])
  })
  it('comunica las omisiones declaradas una vez y descarta texto inseguro', async () => {
    const omissions = [{ item: 'Días sin contacto', reason: 'No hay diferencias de fechas.' }, { item: 'Fecha del último seguimiento', reason: '<script>alert(1)</script>' }]
    const result = await run({ message: 'CRM', blueprint: design(), omissions })
    expect(result.warnings.filter(w => w.includes('Días sin contacto'))).toHaveLength(1)
    expect(result.warnings.join(' ')).not.toContain('<script>')
    expect(result.warnings.find(w => w.includes('fecha del último'))).toContain('no quedó')
    expect(result.valid).toBe(true)
  })
  it('normaliza acentos, plurales y de/del sin confundir un campo con otro módulo', () => {
    const blueprint = design()
    blueprint.modules[0]!.fields[0] = { name: 'dias_contacto', label: 'Día sin contacto', dataType: 'number', validationRules: { calculation: { kind: 'expression', expression: '1' } } }
    expect(designerCoverageWarnings('En Prospectos: Días sin contacto (calculados).', blueprint)).toEqual([])
    expect(designerCoverageWarnings('En Propuestas: Días sin contacto (calculados).', blueprint)).toHaveLength(1)
    expect(designerCoverageWarnings('En Prospectos: Días del contacto (calculados).', { ...blueprint, modules: [{ ...blueprint.modules[0]!, fields: [{ ...blueprint.modules[0]!.fields[0]!, label: 'Dia de contacto' }] }] })).toEqual([])
  })
  it('detecta listas explícitas y acepta catálogos representados con Usuario u opciones', () => {
    const blueprint = design()
    blueprint.modules[0]!.fields.push({ name: 'responsable', label: 'Responsable', dataType: 'user' }, { name: 'etapa', label: 'Etapa', dataType: 'select', validationRules: { options: [{ value: 'nuevo', label: 'Nuevo' }] } })
    const request = 'CATÁLOGOS\n- Responsables (usuarios del equipo).\n- Etapas: Nuevo.\nMÓDULOS\n1) Prospectos: total de seguimientos, teléfono.'
    expect(designerCoverageWarnings(request, blueprint)).toEqual([expect.stringContaining('teléfono')])
    expect(designerRequestedItems('Necesito un CRM automático que sea útil')).toEqual([])
    expect(designerCoverageWarnings('Crea un CRM con contacto y fecha', blueprint)).toEqual([])
    expect(designerCoverageWarnings('Elimina el campo calculado «Días sin contacto»', blueprint)).toEqual([])
    expect(designerCoverageWarnings('Campos calculados en Prospectos: Días sin contacto.', blueprint)).toHaveLength(1)
    expect(normalizeCoverageName('Ciudades y responsables')).toBe(normalizeCoverageName('Ciudad y responsable'))
  })
  it('verifica el plano resultante de parches y conserva las omisiones', async () => {
    const result = await run({ mode: 'patch', message: 'Agregué teléfono', omissions: [{ item: 'Días sin contacto', reason: 'No hay diferencias de fechas.' }], operations: [{ op: 'addField', slug: 'prospectos', field: { name: 'telefono', label: 'Teléfono', dataType: 'text' } }] }, instruction, design())
    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(3)
    expect(result.patch?.omissions).toHaveLength(1)
    const unsafe = await run({ mode: 'patch', message: 'Agregué teléfono', omissions: [{ item: 'Días sin contacto', reason: 'DROP TABLE users' }], operations: [{ op: 'addField', slug: 'prospectos', field: { name: 'telefono', label: 'Teléfono', dataType: 'text' } }] }, instruction, design())
    expect(unsafe.valid).toBe(true)
    expect(unsafe.patch?.omissions).toEqual([])
    expect(unsafe.warnings.join(' ')).not.toContain('DROP')
    const rescued = await run({ mode: 'patch', message: 'Agregué fecha', omissions: [{ item: 'Días sin contacto', reason: 'DROP TABLE users' }], operations: [{ op: 'addField', slug: 'prospectos', field: { name: 'fecha', label: 'Fecha', dataType: 'date', validationRules: { calculation: { kind: 'expression', expression: 'HOY()' } } } }] }, instruction, design())
    expect(rescued.valid).toBe(true)
    expect(rescued.warnings.join(' ')).not.toContain('DROP')
    expect(rescued.warnings.join(' ')).toContain('campo simple')
  })
  it('no duplica avisos de degradación y controla los límites del esquema', () => {
    expect(designerCoverageWarnings(instruction, design(), [], ['Dejé «total de seguimientos» como campo simple.'])).toHaveLength(2)
    expect(designerOmissionsSchema.safeParse([{ item: 'x'.repeat(161), reason: 'Razón' }]).success).toBe(false)
    expect(designerOmissionsSchema.safeParse(Array.from({ length: 41 }, () => ({ item: 'Campo', reason: 'Razón' }))).success).toBe(false)
  })
  it('no genera puntos de relleno aunque los envíe la IA o recorte el servidor', async () => {
    const result = await run({ message: 'CRM', explanation: 'CRM\n### ¿Por qué?\n- …\n- ...\n- \n- **Decisión:** útil.', blueprint: design() })
    expect(result.explanation).not.toMatch(/^\s*[-*+]\s*(?:…|\.{3})?\s*$/m)
    expect(result.explanation).toContain('Decisión')
    const truncated = limitDesignerExplanation('CRM\n### ¿Por qué?\n- ' + 'texto '.repeat(400), ['Aviso'])
    expect(truncated.length).toBeLessThanOrEqual(1500)
    expect(truncated).not.toContain('- …')
  })
  it('conserva todos los avisos en las entradas de chat y usa la lista visible existente', async () => {
    const result = await run({ message: 'CRM', blueprint: design() })
    const entries = designerChatEntries([{ role: 'assistant', content: 'CRM', warnings: result.warnings, createdAt: new Date().toISOString() }], [])
    expect(entries[0]?.warnings).toEqual(result.warnings)
    expect(readFileSync('pages/disenador.vue', 'utf8')).toContain('v-for="(warning, index) in message.warnings"')
  })

  it('REV2: recupera omissions dentro del plano y del módulo antes de validar', async () => {
    const omissions = [{ item: 'Días sin contacto', reason: 'No hay diferencias de fechas.' }]
    const blueprint = { ...design(), omissions }
    blueprint.modules[0] = { ...blueprint.modules[0]!, ...{ omissions: [{ item: 'Fecha del último seguimiento', reason: 'No se calculan fechas.' }] } }
    const complete = vi.fn(async () => ({ value: { message: 'CRM', blueprint }, inputTokens: 1, outputTokens: 1, model: 'simulado' }))
    const result = await runDesignerGeneration({ current: empty, blueprint: empty, instruction, conversation: [], complete, validate: proposal => validateBlueprintAgainstSnapshot(proposal, empty) })
    expect(result.valid).toBe(true)
    expect(complete).toHaveBeenCalledTimes(1)
    expect(result.warnings.filter(w => w.startsWith('No quedó completo'))).toHaveLength(2)
    expect(result.result?.normalized).not.toHaveProperty('omissions')
    expect(result.result?.normalized?.modules[0]).not.toHaveProperty('omissions')
    expect(blueprint).toHaveProperty('omissions', omissions)
  })

  it('REV2: extrae contenedores, elementos y metadatos de operaciones de parche', async () => {
    const omissions = [{ item: 'Días sin contacto', reason: 'No hay diferencias de fechas.' }]
    const result = await run({ mode: 'patch', message: 'Agregué teléfono', operations: [
      { op: 'addField', slug: 'prospectos', field: { name: 'telefono', label: 'Teléfono', dataType: 'text' }, omissions },
      { omissions },
      ...omissions
    ] }, instruction, design())
    expect(result.valid).toBe(true)
    expect(result.patch?.operations).toHaveLength(1)
    expect(result.patch?.omissions).toEqual(omissions)
    expect(result.warnings.filter(w => w.includes('Días sin contacto'))).toHaveLength(1)
    expect(result.result?.normalized?.modules[0]?.fields.some(f => f.name === 'telefono')).toBe(true)
  })

  it('REV2: une y deduplica listas equivalentes en la respuesta y los módulos añadidos', async () => {
    const omissions = [{ item: 'Días sin contacto', reason: 'No hay diferencias de fechas.' }]
    const result = await run({ mode: 'patch', message: 'CRM', omissions, operations: [{ op: 'addModule', module: { ...design().modules[0], omittedItems: omissions } }, { omissions }] })
    expect(result.valid).toBe(true)
    expect(result.patch?.omissions).toEqual(omissions)
    expect(result.warnings.filter(w => w.includes('Días sin contacto'))).toHaveLength(1)
    const full = await run({ message: 'CRM', omissions, blueprint: { ...design(), omissions, notIncluded: omissions } })
    expect(full.valid).toBe(true)
    expect(full.warnings.filter(w => w.includes('Días sin contacto'))).toHaveLength(1)
    expect(designerCoverageWarnings('En Prospectos: Fecha del último seguimiento (calculado).', design(), [{ item: 'Última fecha de seguimiento', reason: 'No se calculan fechas.' }])).toEqual([])
  })

  it('REV2: descarta formas inválidas o inseguras sin afectar al plano y limita el total', async () => {
    const result = await run({ message: 'CRM', omissions: 'incorrecto', blueprint: { ...design(), omissions: [{ item: '', reason: 'No' }, { item: 'Campo', reason: 'DROP TABLE users' }, { item: 'x'.repeat(161), reason: 'No' }] } })
    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(3)
    expect(result.warnings.join(' ')).not.toContain('DROP')
    const extracted = extractDesignerOmissions({ message: 'CRM', blueprint: { ...design(), omissions: Array.from({ length: 45 }, (_, i) => ({ item: `Campo ${i}`, reason: 'No solicitado en el resultado' })) } })
    expect(extracted).toMatchObject({ omissions: expect.any(Array) })
    expect(designerOmissionsSchema.parse((extracted as { omissions: unknown }).omissions)).toHaveLength(40)
    expect((await run({ message: 'CRM', blueprint: { ...design(), omissions: { item: 'Campo', reason: 'Razón' } } })).valid).toBe(true)
  })

  it('REV2: conserva el rechazo de claves ajenas y operaciones desconocidas', async () => {
    const blueprint = { ...design(), unexpected: [{ item: 'Campo' }] }
    const result = await run({ message: 'CRM', blueprint })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.code === 'unrecognized_keys')).toBe(true)
    expect((await run({ mode: 'patch', message: 'CRM', operations: [{ op: 'addModule', module: { ...design().modules[0], unexpected: true } }] })).valid).toBe(false)
    expect((await run({ mode: 'patch', message: 'CRM', operations: [{ unexpected: true }] }, instruction, design())).valid).toBe(false)
  })
})
