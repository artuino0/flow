import { describe, expect, it } from 'vitest'
import { stateWorkflowSchema } from '../../server/utils/stateWorkflow'
import { normalizeDesignerWorkflows } from '../../server/utils/moduleDesigner/normalizeWorkflow'
import { runDesignerGeneration, WORKFLOW_EXAMPLE } from '../../server/utils/moduleDesigner/generate'
import { validateBlueprintAgainstSnapshot } from '../../server/utils/blueprint/validate'

const wrap = (workflow: unknown) => ({ version: 1, summary: 'Prueba', modules: [{ name: 'Pedidos', workflow }], associations: [] })
const get = (workflow: unknown) => {
  const result = normalizeDesignerWorkflows(wrap(workflow))
  return { workflow: (result.blueprint as { modules: Array<{ workflow: unknown }> }).modules[0]!.workflow, warnings: result.warnings }
}

describe('normalización de flujos del diseñador', () => {
  it('convierte estados de strings y completa enabled, initial y roles', () => {
    const result = get({ field: 'estado', states: ['recibido', 'confirmado'], transitions: [{ from: 'recibido', to: 'confirmado', label: 'Confirmar' }] })
    expect(result.workflow).toMatchObject({ enabled: true, initial: 'recibido', states: { recibido: { locked: false, editableFields: [] }, confirmado: { locked: false, editableFields: [] } }, transitions: [{ roles: 'all' }] })
    expect(stateWorkflowSchema.safeParse(result.workflow).success).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it('convierte objetos y descarta una transición hacia un estado desconocido', () => {
    const result = get({ field: 'estado', states: [{ value: 'abierto', label: 'Abierto' }, { name: 'cerrado', locked: true, editableFields: ['nota'] }], transitions: [{ from: 'abierto', to: 'cerrado' }, { from: 'cerrado', to: 'fantasma' }] })
    expect((result.workflow as { states: Record<string, unknown>; transitions: unknown[] }).states.cerrado).toEqual({ locked: true, editableFields: ['nota'] })
    expect((result.workflow as { transitions: unknown[] }).transitions).toHaveLength(1)
    expect(result.warnings.join(' ')).toContain('transición 2')
    expect(stateWorkflowSchema.safeParse(result.workflow).success).toBe(true)
  })

  it('convierte when string y descarta una regla ambigua sin perder el flujo', () => {
    const result = get({ field: 'estado', states: ['recibido', 'confirmado'], rules: [
      { type: 'required', mode: 'block', when: 'confirmado', fields: ['cliente'], message: 'Falta cliente' },
      { type: 'required', when: 'confirmado', fields: ['folio'], message: 'Falta folio' }
    ] })
    expect((result.workflow as { rules: Array<{ when: unknown }> }).rules).toEqual([{ type: 'required', mode: 'block', when: { to: 'confirmado' }, fields: ['cliente'], message: 'Falta cliente' }])
    expect(result.warnings.join(' ')).toContain('regla 2')
    expect(stateWorkflowSchema.safeParse(result.workflow).success).toBe(true)
  })

  it('conserva un flujo ya válido sin advertencias', () => {
    const workflow = { enabled: true, field: 'estado', initial: 'nuevo', states: { nuevo: { locked: false, editableFields: [] } }, transitions: [], rules: [] }
    expect(get(workflow)).toEqual({ workflow, warnings: [] })
  })

  it('incluye el ejemplo válido en la autorreparación de errores workflow', async () => {
    const current = { version: 1 as const, summary: 'Vacío', modules: [], associations: [] }
    const invalid = { ...current, modules: [{ ref: 'pedidos', action: 'create', kind: 'hecho', name: 'Pedidos', slug: 'pedidos', fields: [], workflow: { states: ['nuevo'], transitions: [] } }] }
    const corrected = { ...current, modules: [{ ref: 'pedidos', action: 'create', kind: 'hecho', name: 'Pedidos', slug: 'pedidos', fields: [{ name: 'nombre', label: 'Nombre', dataType: 'text' }] }] }
    const prompts: string[] = []
    const complete = async ({ prompt }: { prompt: string }) => {
      prompts.push(prompt)
      return { value: { message: 'Listo', blueprint: prompts.length === 1 ? invalid : corrected }, inputTokens: 1, outputTokens: 1, model: 'simulado' }
    }
    const result = await runDesignerGeneration({ current, blueprint: current, conversation: [], instruction: 'Crea pedidos', validate: value => validateBlueprintAgainstSnapshot(value, current), complete })
    expect(result.valid).toBe(true)
    expect(result.repairs).toBe(1)
    expect(JSON.parse(prompts[1]!).workflowExample).toBe(WORKFLOW_EXAMPLE)
  })
})
