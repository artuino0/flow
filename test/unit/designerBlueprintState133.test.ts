import { describe, expect, it } from 'vitest'
import type { Blueprint } from '../../server/utils/blueprint/schema'
import { acceptDesignerSession, designerBlueprintsEqual } from '../../utils/designerBlueprintState'
import { canSendDesignerChat } from '../../utils/designerChat'

const normalized: Blueprint = { version: 1, summary: 'Plano', modules: [{ ref: 'clientes', action: 'extend', kind: 'dimension', name: 'Clientes', slug: 'clientes', snapshot: true, fields: [{ name: 'nombre', label: 'Nombre', dataType: 'text', validationRules: { unique: true, maxLength: 100 } }] }], associations: [] }
// Como JSONB: mismas propiedades, distinto orden también en objetos anidados.
const persisted: Blueprint = { summary: normalized.summary, associations: [], modules: [{ slug: 'clientes', fields: [{ validationRules: { maxLength: 100, unique: true }, dataType: 'text', label: 'Nombre', name: 'nombre' }], snapshot: true, name: 'Clientes', kind: 'dimension', action: 'extend', ref: 'clientes' }], version: 1 }

describe('sincronización del plano editable (segundo síntoma ERD-133)', () => {
  it('reproduce el falso dirty por orden de claves y permite seguir con IA después de reparar', () => {
    expect(JSON.stringify(normalized)).not.toBe(JSON.stringify(persisted))
    expect(designerBlueprintsEqual(normalized, persisted)).toBe(true)
    const state = acceptDesignerSession({ blueprint: persisted, version: 2 })
    expect(state.working).not.toBe(state.session.blueprint)
    const dirty = !designerBlueprintsEqual(state.working, state.session.blueprint)
    expect(dirty).toBe(false)
    expect(canSendDesignerChat({ dirty, busy: false, noCredits: false, applied: false })).toBe(true)
  })

  it('detecta una edición real, conserva la base y limpia dirty tras aceptar el guardado', () => {
    const state = acceptDesignerSession({ blueprint: persisted, version: 2 })
    state.working.modules[0]!.fields[0]!.label = 'Nombre completo'
    expect(designerBlueprintsEqual(state.working, state.session.blueprint)).toBe(false)
    expect(state.session.blueprint.modules[0]!.fields[0]!.label).toBe('Nombre')
    const saved = structuredClone(state.working)
    // El servidor puede completar propiedades durante la validación.
    saved.modules[0]!.fields[0]!.required = false
    const accepted = acceptDesignerSession({ blueprint: saved, version: 3 })
    expect(designerBlueprintsEqual(accepted.working, accepted.session.blueprint)).toBe(true)
    expect(accepted.working.modules[0]!.fields[0]).toMatchObject({ label: 'Nombre completo', required: false })
  })

  it('conserva diferencias reales en reglas, valores y orden de los campos', () => {
    const changedRules = structuredClone(normalized)
    changedRules.modules[0]!.fields[0]!.validationRules!.unique = false
    expect(designerBlueprintsEqual(changedRules, normalized)).toBe(false)
    const reordered = structuredClone(normalized)
    reordered.modules[0]!.fields.push({ name: 'nota', label: 'Nota', dataType: 'text' })
    const before = structuredClone(reordered)
    reordered.modules[0]!.fields.reverse()
    expect(designerBlueprintsEqual(reordered, before)).toBe(false)
  })
})
