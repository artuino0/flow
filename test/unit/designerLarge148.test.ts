import { describe, expect, it, vi } from 'vitest'
import { runDesignerGeneration } from '../../server/utils/moduleDesigner/generate'
import { validateBlueprintAgainstSnapshot } from '../../server/utils/blueprint/validate'
import { designerCapabilityWarnings } from '../../server/utils/moduleDesigner/capabilities'
import { designerValidationLog } from '../../server/utils/moduleDesigner/validationLog'
import { degradeDesignerFields } from '../../server/utils/moduleDesigner/degrade'
import type { Blueprint } from '../../server/utils/blueprint/schema'

const current: Blueprint = { version: 1, summary: 'Vacío', modules: [], associations: [] }
const proposal = (): Blueprint => ({ ...current, summary: 'CRM', modules: [{ ref: 'prospectos', slug: 'prospectos', name: 'Prospectos', action: 'create', kind: 'hecho', icon: 'Users', fields: [{ name: 'dias', label: 'Días sin contacto', dataType: 'number', validationRules: { calculation: { kind: 'expression', expression: 'HOY() - fecha' } } }, { name: 'fecha', label: 'Fecha', dataType: 'date' }] }] })
const run = (blueprint: unknown, complete = vi.fn(async (_params: { system: string; prompt: string }) => ({ value: { message: 'CRM', blueprint }, inputTokens: 10, outputTokens: 20, model: 'simulado' }))) => runDesignerGeneration({ current, blueprint: current, conversation: [], instruction: 'CRM completo', complete, validate: value => validateBlueprintAgainstSnapshot(value, current) })

describe('ERD-148: rescate de planos grandes', () => {
  it('degrada un cálculo inválido, conserva los otros campos y publica un aviso', async () => {
    const generated = await run(proposal())
    expect(generated.valid).toBe(true)
    expect(generated.errors).toEqual([])
    expect(generated.result?.normalized?.modules[0]?.fields[0]).toMatchObject({ dataType: 'number', validationRules: {} })
    expect(generated.result?.normalized?.modules[0]?.fields[1]?.name).toBe('fecha')
    expect(generated.warnings.join(' ')).toContain('Días sin contacto')
    expect(generated.warningItems).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'different', text: expect.stringContaining('campo simple') })]))
    expect(generated.explanation).not.toContain('campo simple')
  })
  it('localiza el error y dirige la reparación sin perder metadatos ni filtrar textos al log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const blueprint = proposal()
    blueprint.modules[0]!.fields[0]!.dataType = 'date'
    const complete = vi.fn(async (_params: { system: string; prompt: string }) => ({ value: { message: 'CRM', blueprint }, inputTokens: 10, outputTokens: 20, model: 'simulado' }))
    const generated = await run(blueprint, complete)
    const repair = JSON.parse(complete.mock.calls[1]![0]!.prompt)
    expect(repair.errors[0]).toMatchObject({ moduleName: 'Prospectos', fieldName: 'Días sin contacto', dataType: 'date', ruleKey: 'calculation', code: 'unrecognized_keys' })
    expect(repair.errors[0].message).toContain('no admite')
    expect(repair.instruction).toContain('únicamente')
    const logs = warn.mock.calls.map(call => String(call[0])).join('\n')
    expect(logs).toContain('designer_validation')
    for (const text of ['Prospectos', 'Días sin contacto', 'HOY', 'CRM completo']) expect(logs).not.toContain(text)
    expect(generated.valid).toBe(true)
    warn.mockRestore()
  })
  it('omite una relación rota y revalida', async () => {
    const blueprint = proposal()
    blueprint.modules[0]!.fields = [{ name: 'cliente', label: 'Cliente', dataType: 'relation', validationRules: { relationEntity: 'inexistente' } }]
    const generated = await run(blueprint)
    expect(generated.valid).toBe(true)
    expect(generated.result?.normalized?.modules[0]?.fields).toEqual([])
    expect(generated.warnings.join(' ')).toContain('omití el campo')
  })
  it('no degrada un módulo sin nombre ni ciclos', async () => {
    const blueprint = proposal()
    blueprint.modules[0]!.name = ''
    const generated = await run(blueprint)
    expect(generated.valid).toBe(false)
    expect(generated.errors[0]?.message).toContain('módulo 1')
    const cycle = proposal()
    cycle.modules[0]!.fields = [{ name: 'dias', label: 'Días', dataType: 'number', validationRules: { calculation: { kind: 'expression', expression: 'dias + 1' } } }]
    expect((await run(cycle)).valid).toBe(false)
  })
  it('no modifica campos actuales y no publica un rescate que deja dependencias rotas', async () => {
    const blueprint = proposal()
    const error = { path: 'modules[0].fields[0].validationRules.calculation', message: 'Inválido' }
    expect(degradeDesignerFields(blueprint, [error], blueprint).warnings).toEqual([])
    blueprint.modules[0]!.fields = [{ name: 'estado', label: 'Estado', dataType: 'select', validationRules: {} }]
    blueprint.modules[0]!.workflow = { enabled: true, field: 'estado', initial: 'nuevo', states: { nuevo: { locked: false, editableFields: [] } }, transitions: [] }
    expect((await run(blueprint)).valid).toBe(false)
  })
  it('mantiene el límite del plan y no agrega un tercer intento', async () => {
    const blueprint = proposal()
    blueprint.modules[0]!.fields = []
    const complete = vi.fn(async (_params: { system: string; prompt: string }) => ({ value: { message: 'CRM', blueprint }, inputTokens: 1, outputTokens: 1, model: 'simulado' }))
    const generated = await runDesignerGeneration({ current, blueprint: current, conversation: [], instruction: 'CRM', complete, validate: async value => {
      const result = await validateBlueprintAgainstSnapshot(value, current)
      result.errors.push({ path: 'modules', code: 'plan_limit', message: 'Límite de módulos' })
      return result
    } })
    expect(generated.result?.errors[0]?.code).toBe('plan_limit')
    expect(complete).toHaveBeenCalledTimes(1)
  })
  it('rescata reglas inválidas también en addField de un parche, con reparación localizada', async () => {
    const base = proposal()
    base.modules[0]!.fields = []
    const complete = vi.fn(async (_params: { system: string; prompt: string }) => ({ value: { mode: 'patch', message: 'Agregué días', operations: [{ op: 'addField', slug: 'prospectos', field: { name: 'dias', label: 'Días', dataType: 'date', validationRules: { calculation: { kind: 'expression', expression: 'HOY()' } } } }] }, inputTokens: 1, outputTokens: 1, model: 'simulado' }))
    const generated = await runDesignerGeneration({ current, blueprint: base, conversation: [], instruction: 'Agrega días', complete, validate: value => validateBlueprintAgainstSnapshot(value, current) })
    expect(generated.valid).toBe(true)
    expect(generated.warnings.join(' ')).toContain('campo simple')
    expect(generated.result?.normalized?.modules[0]?.fields[0]?.dataType).toBe('date')
    expect(JSON.parse(complete.mock.calls[1]![0]!.prompt).errors[0]).toMatchObject({ moduleName: 'Prospectos', fieldName: 'Días', ruleKey: 'calculation' })
  })
  it('explica capacidades ausentes sin prometer avisos por tiempo', () => {
    const warnings = designerCapabilityWarnings('Quiero vistas, dashboard, avisos por tiempo y triggers')
    expect(warnings).toHaveLength(3)
    expect(warnings.join(' ')).toContain('no están disponibles')
  })
  it('anonimiza propiedades desconocidas, tipos inválidos y nombres de estados del log', () => {
    const log = designerValidationLog([{ path: 'modules[0].fields[1].validationRules.secreto', ruleKey: 'secreto', dataType: 'secreto', message: 'secreto' }, { path: 'modules[0].workflow.states.secreto.editableFields', message: 'secreto' }], 1)
    expect(JSON.stringify(log)).not.toContain('secreto')
  })

  it('devuelve el plano previo con aviso cuando el único addField no tiene opciones seguras', async () => {
    const base = proposal()
    base.modules[0]!.fields = []
    const complete = vi.fn(async (_params: { system: string; prompt: string }) => ({ value: { mode: 'patch', message: 'Agregué estado', operations: [{ op: 'addField', slug: 'prospectos', field: { name: 'estado', label: 'Estado', dataType: 'select' } }] }, inputTokens: 1, outputTokens: 1, model: 'simulado' }))
    const generated = await runDesignerGeneration({ current, blueprint: base, conversation: [], instruction: 'Agrega estado', complete, validate: value => validateBlueprintAgainstSnapshot(value, current) })
    expect(generated.valid).toBe(true)
    expect(generated.result?.normalized?.modules[0]?.fields).toEqual([])
    expect(generated.warnings.join(' ')).toContain('omití el campo')
  })

})
