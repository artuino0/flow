import { describe, expect, it, vi } from 'vitest'
import type { Blueprint, BlueprintField, BlueprintModule } from '../../server/utils/blueprint/schema'
import { validateBlueprintAgainstSnapshot } from '../../server/utils/blueprint/validate'
import { autoFixDesignerReview, reviewDesignerBlueprint, reviewDoesNotWorsen } from '../../server/utils/moduleDesigner/review'
import { runDesignerGeneration, DESIGNER_SYSTEM_PROMPT } from '../../server/utils/moduleDesigner/generate'
import { designerChatEntries } from '../../utils/designerChat'

const empty: Blueprint = { version: 1, summary: 'Vacío', modules: [], associations: [] }
const select = (name = 'etapa'): BlueprintField => ({ name, label: 'Etapa', dataType: 'select', validationRules: { options: ['nuevo', 'contactado', 'calificado', 'propuesta', 'negociacion', 'ganado', 'perdido'].map(value => ({ value, label: value })) } })
const module = (slug: string, name: string, kind: 'hecho' | 'dimension', fields: BlueprintField[] = []): BlueprintModule => ({ ref: slug, slug, name, kind, action: 'create', icon: 'Box', fields })
const crm = (): Blueprint => ({ ...structuredClone(empty), summary: 'CRM', modules: [module('prospectos', 'Prospectos', 'hecho', [select(), { name: 'nombre', label: 'Nombre', dataType: 'text' }]), module('etapas', 'Etapas del embudo', 'dimension', [{ name: 'nombre', label: 'Nombre', dataType: 'text' }, { name: 'orden', label: 'Orden', dataType: 'number' }, { name: 'activo', label: 'Activo', dataType: 'boolean' }])] })
const validate = (value: unknown) => validateBlueprintAgainstSnapshot(value, empty)
const completion = (value: unknown) => ({ value, inputTokens: 2, outputTokens: 3, model: 'simulado' })
const run = (blueprint: Blueprint, instruction: string, patch?: unknown, current = empty) => {
  const complete = vi.fn(async (_params: { system: string; prompt: string; timeoutMs?: number }) => completion({ message: 'Propuesta', blueprint })).mockImplementationOnce(async () => completion({ message: 'Propuesta', blueprint }))
  if (patch) complete.mockImplementation(async () => completion(patch))
  return { complete, generated: runDesignerGeneration({ current, blueprint: current, conversation: [], instruction, complete, validate: value => validateBlueprintAgainstSnapshot(value, current) }) }
}
const addState = { message: 'Estado para tablero', mode: 'patch', operations: [{ op: 'addField', slug: 'prospectos', field: select() }] }

describe('ERD-160: revisión determinista y dirigida', () => {
  it('reconstruye el CRM: quita el catálogo huérfano, conserva las siete opciones y avisa sin otra llamada', async () => {
    const input = crm()
    expect((await validate(input)).errors).toEqual([])
    const { complete, generated } = run(input, 'Crea un CRM con embudo en Prospectos')
    const result = await generated
    expect(result.valid).toBe(true)
    expect(result.result?.normalized?.modules.map(module => module.slug)).toEqual(['prospectos'])
    expect(result.result?.normalized?.modules[0]?.fields[0]?.validationRules?.options).toHaveLength(7)
    expect(result.review).toMatchObject({ autoFixes: 1, extraCall: false })
    expect(result.warningItems).toContainEqual(expect.objectContaining({ kind: 'different', text: expect.stringContaining('No creé «Etapas del embudo»') }))
    expect(complete).toHaveBeenCalledTimes(1)
    expect(input.modules).toHaveLength(2)
  })
  it('protege nombres explícitos, catálogos independientes y existentes', async () => {
    const input = crm()
    expect((await autoFixDesignerReview(input, empty, 'Catálogos:\n- Etapas del embudo', validate)).warnings).toEqual([])
    expect(reviewDesignerBlueprint(input, empty, 'Catálogo independiente «Etapas del embudo»')).toEqual([])
    const current = structuredClone(input)
    current.modules[1]!.action = 'extend'
    current.modules[1]!.snapshot = true
    expect(reviewDesignerBlueprint(current, current, 'CRM')).toEqual([])
  })
  it('un catálogo conectado se conserva y uno de otro concepto solo informa', async () => {
    const input = crm()
    input.modules[0]!.fields.push({ name: 'etapa_catalogo', label: 'Etapa catálogo', dataType: 'relation', validationRules: { relationEntity: 'etapas' } })
    expect(reviewDesignerBlueprint(input, empty, 'CRM').filter(f => f.rule === 'orphan-catalog')).toEqual([])
    input.modules[0]!.fields.pop()
    input.modules[1]!.name = 'Canales de origen'
    expect(reviewDesignerBlueprint(input, empty, 'CRM')).toEqual([expect.objectContaining({ rule: 'orphan-catalog', severity: 'info' })])
    expect(reviewDesignerBlueprint(input, empty, 'CRM')[0]?.fix).toBeUndefined()
    expect((await autoFixDesignerReview(input, empty, 'CRM', validate)).warnings).toEqual([])
    input.modules[1]!.name = 'Fases de la luna'
    expect(reviewDesignerBlueprint(input, empty, 'CRM')[0]?.fix).toBeUndefined()
  })
  it('reconoce artículos, acentos, singular/plural y sinónimos de estado', () => {
    for (const name of ['Las Etapas del embudo', 'Estados', 'Estatus', 'Status', 'Fáses']) {
      const input = crm()
      input.modules[1]!.name = name
      expect(reviewDesignerBlueprint(input, empty, 'CRM')[0]?.fix).toBeDefined()
    }
  })
  it('aborta autoarreglos que rompen asociaciones, permisos o copyFrom', async () => {
    for (const type of ['association', 'role', 'copy']) {
      const input = crm()
      if (type === 'association') input.associations.push({ name: 'otra', sourceRef: 'prospectos', targetRef: 'etapas' })
      if (type === 'role') input.roles = [{ name: 'Vendedor', permissions: [{ moduleRef: 'etapas', visibility: 'all', canRead: true, canCreate: true, canUpdate: true, canDelete: false }] }]
      if (type === 'copy') input.modules[0]!.fields.push({ name: 'tabla', label: 'Tabla', dataType: 'tabla', validationRules: { columns: [{ name: 'nombre', label: 'Nombre', type: 'text', copyFrom: 'etapas.nombre' }] } })
      const fixed = await autoFixDesignerReview(input, empty, 'CRM', validate)
      expect(fixed.blueprint.modules).toHaveLength(2)
      expect(fixed.warnings).toEqual([])
    }
  })
  it('advierte relación de etapas solo en procesos candidatos, con nivel info si ya hay select', () => {
    const input = crm()
    input.modules[0]!.fields.push({ name: 'etapa_catalogo', label: 'Etapa catálogo', dataType: 'relation', validationRules: { relationEntity: 'etapas' } })
    expect(reviewDesignerBlueprint(input, empty, 'CRM').some(f => f.rule === 'stage-as-relation')).toBe(false)
    expect(reviewDesignerBlueprint(input, empty, 'Embudo de Prospectos').find(f => f.rule === 'stage-as-relation')?.severity).toBe('info')
    input.modules[0]!.fields.shift()
    expect(reviewDesignerBlueprint(input, empty, 'Embudo de Prospectos').find(f => f.rule === 'stage-as-relation')?.severity).toBe('warning')
    input.modules[0]!.workflow = { enabled: true, field: 'etapa', initial: 'nuevo', states: { nuevo: { locked: false, editableFields: [] } }, transitions: [] }
    expect(reviewDesignerBlueprint(input, empty, 'CRM').some(f => f.rule === 'stage-as-relation')).toBe(true)
  })
  it('no adivina módulo principal ni confunde otro select con un estado', () => {
    const input = crm()
    input.modules = [input.modules[0]!]
    input.modules[0]!.fields = [{ ...select('prioridad'), label: 'Prioridad' }]
    expect(reviewDesignerBlueprint(input, empty, 'Embudo').some(f => f.rule === 'kanban-needs-select')).toBe(true)
    input.modules.push(module('pedidos', 'Pedidos', 'hecho'))
    expect(reviewDesignerBlueprint(input, empty, 'Embudo').some(f => f.rule === 'kanban-needs-select')).toBe(false)
    expect(reviewDesignerBlueprint(input, empty, 'Embudo de Prospectos').some(f => f.rule === 'kanban-needs-select')).toBe(true)
    expect(reviewDesignerBlueprint(input, empty, 'CRM').some(f => f.rule === 'kanban-needs-select')).toBe(false)
  })
  it('copyFrom inexistente se detecta; no duplica referencias ya rechazadas por validación', async () => {
    const input = crm()
    input.modules[0]!.fields.push({ name: 'tabla', label: 'Tabla', dataType: 'tabla', validationRules: { columns: [{ name: 'nombre', label: 'Nombre', type: 'text', copyFrom: 'prospectos.ausente' }] } })
    expect((await validate(input)).errors).toEqual([])
    expect(reviewDesignerBlueprint(input, empty, 'CRM').filter(f => f.rule === 'dangling-reference')).toHaveLength(1)
    input.modules[0]!.fields[2]!.validationRules = { columns: [{ name: 'nombre', label: 'Nombre', type: 'text', copyFrom: 'prospectos.nombre' }] }
    expect(reviewDesignerBlueprint(input, empty, 'CRM').filter(f => f.rule === 'dangling-reference')).toEqual([])
    input.modules[0]!.fields.push({ name: 'rota', label: 'Rota', dataType: 'relation', validationRules: { relationEntity: 'ausente' } })
    expect((await validate(input)).errors.length).toBeGreaterThan(0)
    expect(reviewDesignerBlueprint(input, empty, 'CRM').filter(f => f.rule === 'dangling-reference')).toEqual([])
  })
  it('campos normalizados duplicados solo se quitan si su definición es idéntica y no se pidieron', async () => {
    const input = crm()
    input.modules = [input.modules[0]!]
    input.modules[0]!.fields[1]!.name = 'contacto'
    input.modules[0]!.fields.push({ name: 'contactos', label: 'Nombre', dataType: 'text' })
    const fixed = await autoFixDesignerReview(input, empty, 'CRM', validate)
    expect(fixed.warnings).toHaveLength(1)
    expect(fixed.blueprint.modules[0]!.fields).toHaveLength(2)
    expect((await autoFixDesignerReview(input, empty, 'Campo Nombre', validate)).warnings).toEqual([])
    input.modules[0]!.fields[2]!.dataType = 'number'
    expect(reviewDesignerBlueprint(input, empty, 'CRM').find(f => f.rule === 'redundant-duplicate')?.fix).toBeUndefined()
  })
  it('catálogo y select con opciones explícitas iguales informan, valores diferentes no', () => {
    const input = crm()
    input.modules[1]!.name = 'Prioridades'
    input.modules[1]!.fields = [select()]
    expect(reviewDesignerBlueprint(input, empty, 'CRM').some(f => f.rule === 'redundant-duplicate')).toBe(true)
    input.modules[1]!.fields[0]!.validationRules = { options: [{ value: 'otro', label: 'Otro' }] }
    expect(reviewDesignerBlueprint(input, empty, 'CRM').some(f => f.rule === 'redundant-duplicate')).toBe(false)
  })
  it('invoca una sola reparación dirigida, adopta select y suma tokens sin otra generación', async () => {
    const input = crm()
    input.modules = [input.modules[0]!]
    input.modules[0]!.fields = [{ name: 'nombre', label: 'Nombre', dataType: 'text' }]
    const { complete, generated } = run(input, 'Embudo de Prospectos', addState)
    const result = await generated
    expect(complete).toHaveBeenCalledTimes(2)
    expect(result.review).toMatchObject({ extraCall: true, adopted: true })
    expect(result.result?.normalized?.modules[0]?.fields).toContainEqual(select())
    expect(result.usage).toMatchObject({ inputTokens: 4, outputTokens: 6 })
    const second = complete.mock.calls[1]
    expect(second).toBeDefined()
    expect(second![0].timeoutMs).toBeGreaterThan(0)
    expect(second![0].timeoutMs).toBeLessThanOrEqual(90_000)
    expect(Object.keys(JSON.parse(second![0].prompt))).toEqual(['currentBlueprint', 'findings'])
    expect(result.patch).toBeNull()
  })
  it('conserva los metadatos de fusiones anteriores al adoptar autoarreglo o reparación dirigida', async () => {
    for (const deterministic of [true, false]) {
      const input = crm()
      if (!deterministic) { input.modules = [input.modules[0]!]; input.modules[0]!.fields = [] }
      const merge = { from: 'duplicado', to: 'prospectos', message: 'Reutilicé el campo existente', discardedFields: ['nombre'] }
      let checks = 0
      let calls = 0
      const result = await runDesignerGeneration({ current: empty, blueprint: empty, conversation: [], instruction: deterministic ? 'CRM' : 'Embudo de Prospectos', complete: async () => completion(++calls <= 2 ? { message: 'Propuesta', blueprint: input } : addState), validate: async value => {
        const checked = await validate(value)
        if (++checks <= 2) checked.merges.push(merge)
        return checked
      } })
      expect(result.valid).toBe(true)
      expect(result.result?.merges).toEqual([merge])
      expect(result.review).toMatchObject(deterministic ? { autoFixes: 1 } : { adopted: true })
    }
  })
  it('descarta parche inválido, fuera de alcance, inseguro y que no mejora', async () => {
    const input = crm()
    input.modules = [input.modules[0]!]
    input.modules[0]!.fields = [{ name: 'nombre', label: 'Nombre', dataType: 'text' }]
    for (const patch of [
      { message: 'Inválido', mode: 'full', blueprint: empty },
      { message: 'Eliminar', mode: 'patch', operations: [{ op: 'removeModule', slug: 'prospectos' }] },
      { message: 'Inseguro', mode: 'patch', operations: [{ op: 'addField', slug: 'prospectos', field: { ...select(), label: '<script>alert(1)</script>' } }] },
      { ...addState, operations: [{ op: 'addField', slug: 'prospectos', field: { ...select(), name: 'nombre' } }] }
    ]) {
      const { complete, generated } = run(input, 'Embudo de Prospectos', patch)
      const result = await generated
      expect(result.valid).toBe(true)
      expect(result.review).toMatchObject({ extraCall: true, adopted: false })
      expect(result.result?.normalized?.modules[0]?.fields).toEqual(input.modules[0]!.fields)
      expect(complete).toHaveBeenCalledTimes(2)
    }
    expect(reviewDoesNotWorsen(input, input, empty, 'Embudo')).toBe(false)
  })
  it('menos cobertura descarta la reparación aunque resuelva el hallazgo', () => {
    const before = crm()
    before.modules = [before.modules[0]!]
    before.modules[0]!.fields.shift()
    const after = structuredClone(before)
    after.modules[0]!.fields = [select()]
    expect(reviewDoesNotWorsen(before, after, empty, 'MÓDULOS\n1. Prospectos: Nombre\nEmbudo de Prospectos')).toBe(false)
  })
  it('respeta plazo agotado y conserva el resultado ante timeout o indisponibilidad', async () => {
    const input = crm()
    input.modules = [input.modules[0]!]
    input.modules[0]!.fields = []
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(100_000)
    const exhausted = run(input, 'Embudo de Prospectos', addState)
    expect((await exhausted.generated).review?.extraCall).toBe(false)
    expect(exhausted.complete).toHaveBeenCalledTimes(1)
    now.mockRestore()
    const complete = vi.fn(async () => completion({ message: 'Propuesta', blueprint: input })).mockImplementationOnce(async () => completion({ message: 'Propuesta', blueprint: input })).mockImplementation(async () => { throw new Error('timeout') })
    const result = await runDesignerGeneration({ current: empty, blueprint: empty, conversation: [], instruction: 'Embudo de Prospectos', complete, validate })
    expect(result.valid).toBe(true)
    expect(result.review).toMatchObject({ extraCall: true, adopted: false })
    expect(complete).toHaveBeenCalledTimes(2)
  })
  it('no revisa un plano inválido; los existentes permanecen intactos; el log omite nombres', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const input = crm()
    const existing = module('clientes', 'Clientes privados', 'dimension', [{ name: 'nombre', label: 'Nombre privado', dataType: 'text' }])
    existing.snapshot = true
    existing.action = 'extend'
    const current = { ...empty, modules: [existing] }
    input.modules.push(structuredClone(existing))
    const result = await run(input, 'CRM secreto', undefined, current).generated
    expect(result.result?.normalized?.modules.find(module => module.slug === 'clientes')).toEqual(existing)
    const event = log.mock.calls.map(call => String(call[0])).find(line => line.includes('designer_review'))!
    expect(JSON.parse(event)).toMatchObject({ level: 'info', autoFixes: 1, rules: ['orphan-catalog'] })
    for (const name of ['Prospectos', 'Etapas', 'Clientes', 'privado', 'CRM secreto']) expect(event).not.toContain(name)
    input.modules[0]!.name = ''
    expect((await run(input, 'CRM', undefined, current).generated).review).toBeUndefined()
    log.mockRestore()
  })
  it('mantiene compatibilidad del chat sin revisión y agrega criterio al prompt', () => {
    expect(designerChatEntries([{ role: 'assistant', content: 'Anterior', createdAt: '2026-01-01' }], [])[0]?.content).toBe('Anterior')
    expect(DESIGNER_SYSTEM_PROMPT).toContain('Un catálogo nuevo solo se crea si algún campo relation lo va a usar')
  })
})
