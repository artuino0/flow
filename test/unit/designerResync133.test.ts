import { describe, expect, it, vi } from 'vitest'
import type { Blueprint } from '../../server/utils/blueprint/schema'
import { resyncDesignerBase, STALE_DESIGN_MESSAGE } from '../../server/utils/moduleDesigner/resync'
import { validateBlueprintAgainstSnapshot } from '../../server/utils/blueprint/validate'
import { runDesignerGeneration } from '../../server/utils/moduleDesigner/generate'

const old: Blueprint = { version: 1, summary: 'Base anterior', associations: [], modules: Array.from({ length: 12 }, (_, index) => ({ ref: `modulo-${index}`, slug: `modulo-${index}`, name: `Módulo ${index}`, kind: 'dimension', action: 'extend', snapshot: true, fields: [{ name: 'nombre', label: 'Nombre', dataType: 'text' }] })) }
const current: Blueprint = { version: 1, summary: 'Base actual', associations: [], modules: [{ ref: 'pacientes', slug: 'pacientes', name: 'Pacientes', kind: 'dimension', action: 'extend', snapshot: true, fields: [{ name: 'nombre', label: 'Nombre', dataType: 'text' }] }] }

describe('base desactualizada del diseñador (ERD-133)', () => {
  it('reproduce los módulos inexistentes y los resincroniza sin mutar la sesión', async () => {
    const session = { blueprint: structuredClone(old), version: 1, messages: [] }
    const invalid = await validateBlueprintAgainstSnapshot(session.blueprint, current)
    expect(invalid.errors).toEqual([{ path: 'modules', message: STALE_DESIGN_MESSAGE, code: 'stale_blueprint' }])
    const repaired = resyncDesignerBase(session, current)
    expect(repaired).toEqual({ blueprint: current, resynced: true, stale: true })
    expect(session.blueprint).toEqual(old)
    expect((await validateBlueprintAgainstSnapshot(repaired.blueprint, current)).errors).toEqual([])
  })

  it('no descarta propuestas, ediciones manuales ni extensiones parciales', () => {
    for (const session of [
      { blueprint: old, version: 2, messages: [] },
      { blueprint: old, version: 1, messages: [{ role: 'assistant' }] },
      { blueprint: { ...old, modules: [...old.modules, { ...old.modules[0], action: 'create', snapshot: false }] }, version: 1, messages: [] },
      { blueprint: { ...old, modules: old.modules.map(module => ({ ...module, snapshot: false })) }, version: 1, messages: [] }
    ]) {
      expect(resyncDesignerBase(session, current)).toEqual({ blueprint: session.blueprint, resynced: false, stale: true })
    }
    expect(resyncDesignerBase({ blueprint: current, version: 1, messages: [] }, current).resynced).toBe(false)
  })

  it('entrega la base actual al proveedor y conserva las instantáneas reales', async () => {
    const base = resyncDesignerBase({ blueprint: old, version: 1, messages: [] }, current)
    const complete = vi.fn(async ({ prompt }: { prompt: string }) => {
      const context = JSON.parse(prompt)
      expect(context.currentBlueprint.modules.map((module: { slug: string }) => module.slug)).toEqual(['pacientes'])
      return { value: { mode: 'patch', message: 'Agregué el teléfono.', operations: [{ op: 'addField', slug: 'pacientes', field: { name: 'telefono', label: 'Teléfono', dataType: 'text' } }] }, inputTokens: 1, outputTokens: 1, model: 'simulado' }
    })
    const generated = await runDesignerGeneration({ current, blueprint: base.blueprint, conversation: [], instruction: 'Agrega teléfono', complete, validate: value => validateBlueprintAgainstSnapshot(value, current) })
    expect(generated.valid).toBe(true)
    expect(complete).toHaveBeenCalledTimes(1)
    expect(generated.result?.normalized?.modules[0]).toMatchObject({ slug: 'pacientes', action: 'extend', snapshot: true })
  })
})
